import Stripe from 'stripe';

const SITE='https://web-by-elie.com';
const BACKEND='https://photosbyelie-checkout-mock.ec92009.workers.dev';
const TTL=30*86400;
const CATALOG={
 'easier-week':{name:'The Easier Week Kit',host:'June Rowan',page:'june.rowan',amount:1500},
 'before-you-spend':{name:'Before You Spend Kit',host:'Nora Vela',page:'nora.vela',amount:1900},
 'say-it-clearly':{name:'Say It Clearly',host:'Elena Brooks',page:'elena.brooks',amount:1500},
};
const cors={'access-control-allow-origin':SITE,'access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-headers':'content-type,idempotency-key','vary':'Origin'};
const headers={...cors,'cache-control':'private, no-store','cdn-cache-control':'no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff'};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{...headers,'content-type':'application/json'}});
const key=id=>'tilbury:order:'+id;
const read=(env,k)=>env.ORDERS_KV.get(k,'json');
const save=(env,k,v)=>env.ORDERS_KV.put(k,JSON.stringify(v),{expirationTtl:v.created?Math.max(60,Math.floor(v.created+TTL-Date.now()/1000)):TTL});
const client=env=>new Stripe(env.STRIPE_SECRET_KEY,{apiVersion:'2026-08-26.dahlia',httpClient:Stripe.createFetchHttpClient(),maxNetworkRetries:2});

/** Authenticate administrative provisioning using the existing local PBE connector. */
function owner(request,env){
 const token=request.headers.get('authorization')?.replace(/^Bearer /,'')||'';
 const tokens=JSON.parse(env.OWNER_CONNECTOR_TOKENS_JSON||'{}');
 return token.length>=24&&Object.values(tokens).some(v=>typeof v==='string'&&v===token);
}

/** Create only the fixed Tilbury products, prices and dedicated webhook. */
async function setup(request,env,stripe){
 if(!owner(request,env))return json({error:'Unauthorized'},401);
 const config=await read(env,'tilbury:configuration')||{products:{}};
 if(config.setup_locked)return json({ready:true,products:config.products,webhook:config.webhook,automatic_tax:config.automatic_tax,tax_registration_status:config.tax_registration_status,merchant:config.merchant});
 for(const [sku,p] of Object.entries(CATALOG)){
  if(!await env.PRIVATE_MEDIA.head('tilbury/products/'+sku+'.zip'))return json({error:'Product file is missing: '+sku},409);
  const id='tilbury_'+sku.replaceAll('-','_')+'_v1';
  let product;try{product=await stripe.products.retrieve(id)}catch(e){if(e.code!=='resource_missing')throw e;product=await stripe.products.create({id,name:p.name,description:p.host+' digital kit from Web By Elie. One-time purchase; personal use.',metadata:{tilbury:'v1',sku}}, {idempotencyKey:'tilbury-product-'+sku+'-v1'})}
  let price=(await stripe.prices.list({lookup_keys:[id+'_usd'],active:true,limit:1})).data[0];
  if(!price)price=await stripe.prices.create({product:product.id,currency:'usd',unit_amount:p.amount,tax_behavior:'exclusive',lookup_key:id+'_usd',metadata:{tilbury:'v1',sku}},{idempotencyKey:'tilbury-price-'+sku+'-v1'});
  if(price.unit_amount!==p.amount||price.currency!=='usd')throw new Error('Unexpected existing Tilbury price');
  config.products[sku]={product:product.id,price:price.id};
  await save(env,'tilbury:configuration',config);
 }
 // Keep durable configuration longer than order records.
 let secret=await env.ORDERS_KV.get('tilbury:webhook-secret');
 const url=BACKEND+'/tilbury/webhook';
 let endpoint=(await stripe.webhookEndpoints.list({limit:100})).data.find(e=>e.url===url);
 if(endpoint&&!secret){await stripe.webhookEndpoints.del(endpoint.id);endpoint=null}
 if(!endpoint){
  endpoint=await stripe.webhookEndpoints.create({url,description:'Web By Elie — Tilbury digital product delivery',enabled_events:['checkout.session.completed','checkout.session.async_payment_succeeded','charge.refunded','charge.dispute.created'],api_version:'2026-08-26.dahlia'});
  await env.ORDERS_KV.put('tilbury:webhook-secret',endpoint.secret);
 }
 config.webhook=endpoint.id;
 try{config.automatic_tax=(await stripe.tax.registrations.list({status:'active',limit:1})).data.length>0;config.tax_registration_status=config.automatic_tax?'active':'none_found'}catch{config.automatic_tax=false;config.tax_registration_status='unavailable'}
 const account=await stripe.accounts.retrieve();config.merchant={id:account.id,name:account.business_profile?.name||account.settings?.dashboard?.display_name||'Photos By Elie',charges_enabled:account.charges_enabled};
 if(!account.charges_enabled)throw new Error('Stripe charges are not enabled');
 config.setup_locked=true;
 await env.ORDERS_KV.put('tilbury:configuration',JSON.stringify(config));
 return json({ready:true,products:config.products,webhook:config.webhook,automatic_tax:config.automatic_tax,tax_registration_status:config.tax_registration_status,merchant:config.merchant});
}

/** Start a server-priced Checkout Session; the request cannot choose an amount. */
async function checkout(request,env,stripe){
 if(request.headers.get('origin')!==SITE)return json({error:'Open checkout from the product page.'},403);
 if(Number(request.headers.get('content-length'))>2048)return json({error:'Request too large'},413);
 const body=await request.json();const p=CATALOG[body.sku];
 if(!p||body.digitalConsent!==true||body.termsConsent!==true)return json({error:'Choose a product and accept the purchase terms.'},400);
 const attempt=request.headers.get('idempotency-key')||'';
 if(!/^[a-zA-Z0-9-]{20,80}$/.test(attempt))return json({error:'Invalid checkout request'},400);
 const config=await read(env,'tilbury:configuration');
 if(!config?.products[body.sku]?.price)return json({error:'Checkout is not available yet.'},503);
 const orderId='tilbury-'+attempt;
 const metadata={tilbury:'v1',sku:body.sku,order_id:orderId,terms_version:'2026-10-16',digital_delivery_consent:'yes'};
 const session=await stripe.checkout.sessions.create({mode:'payment',line_items:[{price:config.products[body.sku].price,quantity:1}],
  success_url:SITE+'/creators.order?session_id={CHECKOUT_SESSION_ID}',cancel_url:SITE+'/'+p.page+'#shop',
  metadata,client_reference_id:orderId,automatic_tax:{enabled:config.automatic_tax===true},
  consent_collection:{terms_of_service:'required'},
  custom_text:{terms_of_service_acceptance:{message:'I agree to the [Web By Elie digital product terms]('+SITE+'/creators.terms).'},submit:{message:'One-time digital purchase from Web By Elie. Download after confirmed payment. Your bank may show Photos By Elie.'}},
  payment_intent_data:{description:p.name+' — Web By Elie',metadata,statement_descriptor_suffix:'WEB BY ELIE'},
  integration_identifier:'tilbury_shop_rkmvpsaj',expires_at:Math.floor(Date.now()/1000)+1800,
 },{idempotencyKey:'tilbury-checkout-'+body.sku+'-'+attempt});
 await save(env,key(session.id),{session:session.id,sku:body.sku,orderId,status:'pending',created:session.created});
 return json({url:session.url});
}

/** Confirm Stripe payment, product, amount, age and refund state before delivery. */
async function paidSession(id,env,stripe){
 if(!/^cs_live_[A-Za-z0-9_]{20,200}$/.test(id))return null;
 const session=await stripe.checkout.sessions.retrieve(id,{expand:['payment_intent.latest_charge']});
 const p=CATALOG[session.metadata?.sku];
 if(!p||session.metadata.tilbury!=='v1'||session.payment_status!=='paid'||session.status!=='complete'||session.currency!=='usd'||session.amount_subtotal!==p.amount||Date.now()/1000-session.created>TTL)return null;
 const charge=session.payment_intent?.latest_charge;
 if(!charge||typeof charge==='string'||charge.refunded||charge.amount_refunded>0||charge.disputed)return null;
 const config=await read(env,'tilbury:configuration');
 const items=await stripe.checkout.sessions.listLineItems(id,{limit:2});
 if(items.data.length!==1||items.data[0].quantity!==1||items.data[0].price?.id!==config?.products[session.metadata.sku]?.price)return null;
 return session;
}

/** Persist an entitlement and send one recovery email using Resend idempotency. */
async function fulfill(session,env,requireEmail=false){
 const sku=session.metadata.sku,p=CATALOG[sku];
 const prior=await read(env,key(session.id));
 const record={...prior,session:session.id,sku,orderId:session.metadata.order_id,status:'paid',created:session.created,expires:session.created+TTL};
 await save(env,key(session.id),record);
 const email=session.customer_details?.email||session.customer_email;
 if(!prior?.email_sent&&email&&env.RESEND_API_KEY){
  const recovery=SITE+'/creators.order?session_id='+encodeURIComponent(session.id);
  const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{authorization:'Bearer '+env.RESEND_API_KEY,'content-type':'application/json','idempotency-key':'tilbury-delivery-'+session.id},body:JSON.stringify({from:env.ORDER_EMAIL_FROM,to:[email],reply_to:'hello@web-by-elie.com',subject:'Your '+p.name+' — Web By Elie',text:'Thank you for your purchase from Web By Elie.\n\nOpen your private delivery page:\n'+recovery+'\n\nDownloads are available for 30 days after purchase. Keep your ZIP and this email. This link grants access to your purchase; do not share it.\n\nNeed help? Reply to hello@web-by-elie.com with your purchase email and receipt reference. Never send card details.\n\nThe presenter '+p.host+' is a fictional AI creator. This is a one-time purchase.'})});
  if(!r.ok){if(requireEmail)throw new Error('Delivery email could not be sent')}
  else{record.email_sent=true;await save(env,key(session.id),record);}
 }
 return record;
}

/** Validate a dedicated webhook before invoking the same idempotent fulfillment. */
async function webhook(request,env,stripe){
 const secret=await env.ORDERS_KV.get('tilbury:webhook-secret');if(!secret)return json({error:'Not configured'},503);
 let event;try{event=await stripe.webhooks.constructEventAsync(await request.text(),request.headers.get('stripe-signature'),secret,300,Stripe.createSubtleCryptoProvider())}catch{return json({error:'Invalid signature'},400)}
 if(event.type==='checkout.session.completed'||event.type==='checkout.session.async_payment_succeeded'){
  const s=event.data.object;if(s.metadata?.tilbury==='v1'&&s.payment_status==='paid'){
   const paid=await paidSession(s.id,env,stripe);if(paid)await fulfill(paid,env,true);
  }
 }
 // Every download checks current refund/dispute status directly with Stripe.
 return json({received:true});
}

/** Handle only the Tilbury namespace; delegate all PBE behavior unchanged. */
export async function handleTilbury(request,env){
 const url=new URL(request.url),path=url.pathname;
 if(!path.startsWith('/tilbury/')&&path!=='/stripe-webhook')return null;
 const stripe=client(env);
 if(path==='/stripe-webhook'){
  const copy=await request.clone().text();let parsed;try{parsed=JSON.parse(copy)}catch{return null}
  if(parsed.data?.object?.metadata?.tilbury!=='v1')return null;
  try{await stripe.webhooks.constructEventAsync(copy,request.headers.get('stripe-signature'),env.STRIPE_WEBHOOK_SECRET,300,Stripe.createSubtleCryptoProvider());return json({received:true,namespace:'tilbury'})}catch{return json({error:'Invalid signature'},400)}
 }
 try{
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(path==='/tilbury/setup'&&request.method==='POST')return await setup(request,env,stripe);
  if(path==='/tilbury/checkout'&&request.method==='POST')return await checkout(request,env,stripe);
  if(path==='/tilbury/webhook'&&request.method==='POST')return await webhook(request,env,stripe);
  if(path==='/tilbury/catalog'&&request.method==='GET'){const c=await read(env,'tilbury:configuration');return json({ready:!!c?.webhook,products:CATALOG})}
  if((path==='/tilbury/order'||path==='/tilbury/download')&&request.method==='GET'){
   const id=url.searchParams.get('session_id')||'';
   const session=await paidSession(id,env,stripe);
   if(!session)return json({error:'Payment is pending, access has expired, or this order is unavailable.'},403);
   const record=await fulfill(session,env),p=CATALOG[record.sku];
   if(path==='/tilbury/order')return json({paid:true,name:p.name,host:p.host,page:p.page,expires:record.expires,download:BACKEND+'/tilbury/download?session_id='+encodeURIComponent(id)});
   const file=await env.PRIVATE_MEDIA.get('tilbury/products/'+record.sku+'.zip');
   if(!file)return json({error:'Download temporarily unavailable; please contact support.'},503);
   return new Response(file.body,{headers:{...headers,'content-type':'application/zip','content-disposition':'attachment; filename="'+record.sku+'.zip"'}});
  }
  return json({error:'Not found'},404);
 }catch(e){console.error('Tilbury request failed',e.type||e.name,e.code||'');return json({error:'This request could not be completed. Please try again or contact hello@web-by-elie.com.'},502)}
}
