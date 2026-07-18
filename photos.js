const root = document.documentElement;
const key = 'byelie-theme';
const btn = document.querySelector('[data-theme-toggle]');
const languageKey = 'byelie-language';
const languageBtn = document.querySelector('[data-language-toggle]');
const displaySettingsKey = 'photosbyelie-display-settings';
const languages = [
  { code: 'en', label: 'English' },
  { code: 'fr', label: 'Français' },
  { code: 'es', label: 'Español' },
];
const translations = {
  en: {
    'a11y.skip': 'Skip to content',
    'a11y.site_nav': 'Site navigation',
    'a11y.footer_nav': 'Footer navigation',
    'a11y.collection_pagination': 'Collection pagination',
    'a11y.photo_navigation': 'Photo navigation',
    'a11y.like_photo': 'Like this photo',
    'a11y.unlike_photo': 'Unlike this photo',
    'a11y.back_to_top': 'Back to top',
    'a11y.open_liked': 'Open liked photos',
    'a11y.open_basket': 'Open basket',
    'a11y.add_to_basket': 'Add to basket',
    'a11y.remove_from_basket': 'Remove from basket',
    'a11y.bottom_photo_actions': 'Bottom photo actions',
    'a11y.gallery_filters': 'Gallery filters and sorting',
    'a11y.gallery_view_controls': 'Gallery view controls',
    'a11y.gallery_image_fit': 'Gallery image fit',
    'a11y.order_progress': 'Order progress',
    'a11y.select_liked_resolutions': 'Select liked photo resolutions',
    'nav.photos': 'Photos',
    'nav.gallery': 'Gallery',
    'nav.basket': 'Basket',
    'nav.liked': 'Liked',
    'nav.collections': 'Collections',
    'nav.owner': 'Owner',
    'nav.support': 'Support and license',
    'footer.credit_prefix': 'Site creation and ongoing maintenance by',
    'theme.night': 'Night',
    'theme.day': 'Day',
    'settings.open': 'Settings',
    'settings.title': 'Settings',
    'settings.close': 'Close settings',
    'settings.language': 'Language',
    'settings.appearance': 'Appearance',
    'settings.transparency': 'Transparency',
    'settings.translucency': 'Translucency',
    'settings.solid': 'Solid',
    'settings.clear': 'Clear',
    'settings.sharp': 'Sharp',
    'settings.frosted': 'Frosted',
    'account.open': 'Account',
    'account.title': 'Account',
    'account.close': 'Close account',
    'account.visitor_status': 'Browse as a visitor',
    'account.choose': 'Continue without signing in, or verify your email with Google.',
    'account.continue_visitor': 'Continue as visitor',
    'account.continue_browsing': 'Continue browsing',
    'account.sign_up_google': 'Sign up with Google',
    'account.sign_in_google': 'Sign in with Google',
    'account.sign_out': 'Sign out',
    'account.signed_in': 'Signed in',
    'account.verified_email': 'Email verified by Google.',
    'account.loading': 'Checking account...',
    'account.redirecting': 'Opening Google sign-in...',
    'account.signing_out': 'Signing out...',
    'account.login_unavailable': 'Google login is not available from this page.',
    'account.session_failed': 'Could not check the Google session.',
    'account.memory_title': 'Saved profile',
    'account.memory_body': 'Orders and download links load from your verified email. Save liked/basket copies this browser\'s liked photos and basket into the account.',
    'account.memory_counts': '{likes} liked · {basket} basket · {orders} orders',
    'account.sync_now': 'Save liked/basket',
    'account.sync_help': 'Saves liked photos and basket choices from this browser. Orders and download links are attached automatically to your checkout email.',
    'account.open_liked': 'Open liked',
    'account.open_basket': 'Open basket',
    'account.orders_title': 'Orders and downloads',
    'account.no_orders': 'No orders saved to this account yet.',
    'account.view_downloads': 'Open order',
    'account.resend_downloads': 'Resend instructions',
    'account.resend_unavailable': 'Resend after files are ready',
    'account.order_resending': 'Sending download instructions...',
    'account.order_resent': 'Download instructions sent to {email}.',
    'account.order_resend_failed': 'Could not resend instructions: {message}',
    'account.order_ready': 'Ready',
    'account.order_pending': 'Pending',
    'account.profile_loaded': 'Orders refreshed.',
    'account.profile_saved': 'Liked and basket saved.',
    'account.profile_syncing': 'Updating account...',
    'account.profile_failed': 'Could not update account.',
    'home.lead': 'A selected camera-photo archive with country galleries and fresh representative samples as the collection rail turns.',
    'home.view_collections': 'View collections',
    'home.collections': 'Collections',
    'home.discover': 'Find photos',
    'home.collection_filter': 'Collection',
    'home.results': 'Search results',
    'home.loading_catalog': 'Loading catalog...',
    'home.catalog_ready': '{count} photos ready.',
    'home.showing_results': 'Showing {count} of {total} photos.',
    'home.showing_matches': 'Showing {count} of {total} matches.',
    'home.no_matches': 'No photos match the current filters.',
    'home.show_more': 'Show more',
    'home.show_all': 'Show all',
    'home.see_more_count': 'Show {count} more',
    'home.see_all_count': 'Show all {count}',
    'home.title_required': 'Title cannot be empty.',
    'home.saving_metadata': 'Saving metadata...',
    'home.metadata_saved': '{title} metadata saved.',
    'home.metadata_failed': 'Could not save metadata.',
    'home.moved_blocked': '{title} moved to Waste Basket.',
    'home.block_failed': 'Could not move photo to Waste Basket.',
    'home.discarded': '{title} discarded.',
    'home.discard_failed': 'Could not discard photo.',
    'home.undo_failed': 'Could not undo the last basket move.',
    'home.nothing_to_undo': 'No local basket move to undo.',
    'home.undo_done': 'Last basket move undone.',
    'home.owner_action_failed': 'Owner action failed.',
    'collection.france': 'France',
    'collection.usa': 'USA',
    'collection.spain': 'Spain',
    'collection.apple-2025-alhaurin-de-la-torre-sunset': '2025 Alhaurin de la Torre, Sunset',
    'collection.apple-2025-cadiz': '2025 Cadiz',
    'collection.apple-2025-cordoba-la-mezquita': '2025 Cordoba, la Mezquita',
    'collection.apple-2025-florence': '2025 Florence',
    'collection.apple-2025-fuengirola-moon-over-the-mediterranean': '2025 Fuengirola, Moon over the Mediterranean',
    'collection.apple-2025-madrid-real-palacio': '2025 Madrid, Real Palacio',
    'collection.apple-2025-pisa': '2025 Pisa',
    'collection.apple-2025-ronda': '2025 Ronda',
    'collection.apple-2025-san-gimignano': '2025 San Gimignano',
    'collection.apple-2025-seville': '2025 Seville',
    'collection.apple-2025-valencia-aquarium': '2025 Valencia, Aquarium',
    'collection.apple-2025-valencia-catedral': '2025 Valencia, Catedral',
    'collection.apple-2025-views-from-home-malaga-airport': '2025 Views from home, Malaga Airport',
    'collection.apple_2025_cordoba_la_mezquita': '2025 Cordoba, la Mezquita',
    'collection.apple-2026-malaga-museo-ruso': '2026 Malaga Museo Ruso',
    'collection.apple-2026-nerja-caves': '2026 Nerja Caves',
    'collection.apple_2026_malaga_museo_ruso': '2026 Malaga Museo Ruso',
    'collection.apple_2026_nerja_caves': '2026 Nerja Caves',
    'collection.mexico': 'Mexico',
    'collection.ai': 'AI Images',
    'collection.italy': 'Italy',
    'collection.portugal': 'Portugal',
    'collection.slovakia': 'Slovakia',
    'collection.panoramas': 'Panoramas',
    'collection.video-trial': 'Cordoba Video Trial',
    'common.back_to_collections': 'Back to collections',
    'common.back_to_gallery': 'Back to gallery',
    'common.back_to_search': 'Back to search',
    'common.previous': 'Previous',
    'common.next': 'Next',
    'common.refresh': 'Refresh',
    'common.photo': 'Photo',
    'common.photo_detail': 'Photo detail',
    'preview.full_height': 'Full height',
    'preview.fit_width': 'Fit width',
    'gallery.grid': 'Grid',
    'gallery.fit': 'Fit',
    'gallery.fill': 'Fill',
    'gallery.make_selection': 'Search',
    'gallery.orientation': 'Orientation',
    'gallery.origin': 'Origin',
    'gallery.search': 'Search',
    'gallery.search_placeholder': 'Title or keyword',
    'gallery.date_from': 'Date from',
    'gallery.date_to': 'Date to',
    'gallery.any_date': 'Any date',
    'gallery.media': 'Media',
    'gallery.all_media': 'All media',
    'gallery.photos': 'Photos',
    'gallery.videos': 'Videos',
    'gallery.color_mood': 'Color mood',
    'gallery.subject': 'Subject',
    'gallery.sort': 'Sort',
    'gallery.all': 'All',
    'gallery.pano': 'Pano',
    'gallery.landscape': 'Landscape',
    'gallery.portrait': 'Portrait',
    'gallery.square': 'Square',
    'gallery.min_size': 'Min size',
    'gallery.min_duration': 'Min duration',
    'gallery.any_size': 'Any size',
    'gallery.any_duration': 'Any duration',
    'gallery.size_1mp': '1 MP+',
    'gallery.size_3mp': '3 MP+',
    'gallery.size_6mp': '6 MP+',
    'gallery.size_10mp': '10 MP+',
    'gallery.size_20mp': '20 MP+',
    'gallery.duration_5s': '5 sec+',
    'gallery.duration_10s': '10 sec+',
    'gallery.duration_20s': '20 sec+',
    'gallery.duration_30s': '30 sec+',
    'gallery.duration_60s': '60 sec+',
    'origin.camera': 'Camera photo',
    'origin.ai': 'AI image',
    'gallery.warm': 'Warm',
    'gallery.cool': 'Cool',
    'gallery.neutral': 'Neutral',
    'gallery.vivid': 'Vivid',
    'gallery.architecture': 'Architecture',
    'gallery.water': 'Water/coast',
    'gallery.art': 'Art/museum',
    'gallery.people': 'People',
    'gallery.nature': 'Nature',
    'gallery.city': 'City/travel',
    'gallery.newest': 'Newest first',
    'gallery.oldest': 'Oldest first',
    'gallery.collection_order': 'Collection order',
    'gallery.title': 'Title',
    'gallery.largest_mp': 'Largest MP',
    'gallery.smallest_mp': 'Smallest MP',
    'gallery.longest_duration': 'Longest',
    'gallery.shortest_duration': 'Shortest',
    'gallery.highest_price': 'Highest price',
    'gallery.lowest_price': 'Lowest price',
    'gallery.mood_photos_only': 'Color mood is available for photos only',
    'gallery.clear': 'Clear',
    'gallery.no_filter_matches': 'No photos match the current filters',
    'gallery.no_visible': 'No locally visible photos in this collection',
    'gallery.clear_filters': 'Clear filters',
    'gallery.adjust_filters': 'Adjust or clear filters to show this collection again.',
    'gallery.showing_count': 'Showing {count} photos.',
    'gallery.showing_filtered': 'Showing {count} of {total} photos.',
    'gallery.showing_count_items': 'Showing {count} {items}.',
    'gallery.showing_filtered_items': 'Showing {count} of {total} {items}.',
    'gallery.media_photos': 'photos',
    'gallery.media_videos': 'videos',
    'gallery.media_items': 'media items',
    'gallery.reserve_available': '{status} Reserve refill is available.',
    'detail.pick_resolution': 'Pick a resolution',
    'detail.total_selected': 'Total selected:',
    'detail.archive_reset_title': 'Archive reset in progress',
    'detail.no_published_meta': '{collection} / No published photos yet',
    'detail.no_published': 'No published photos yet',
    'detail.rebuilding': 'This gallery is being rebuilt from the Saturn archive.',
    'detail.mp_verified': '{mp} MP verified',
    'detail.info': 'Info',
    'detail.shortcuts': 'Shortcuts:',
    'detail.like': 'like',
    'detail.prev_next': 'previous/next',
    'detail.full_screen': 'full screen',
    'detail.hide': 'hide',
    'detail.undo': 'undo',
    'detail.open_full_screen': 'Close full screen preview for {title}',
    'detail.added_liked': '{title} added to liked photos.',
    'detail.removed_liked': '{title} removed from liked photos.',
    'detail.removed_basket': '{title} removed from basket.',
    'detail.no_selection': 'No basket selections for this photo.',
    'detail.saved': '{title} order selections saved.',
    'detail.count': 'Count',
    'detail.frame': 'Frame',
    'basket.title': 'Basket',
    'basket.empty': 'Your basket is empty.',
    'basket.order_intent': 'Order intent',
    'basket.confirm_assets': 'Confirm digital assets',
    'basket.license_note': 'Review your selected digital files before checkout. Personal print and web use is included; commercial, resale, and AI-training use need written approval.',
    'basket.buyer_email': 'Buyer email',
    'basket.pay_guest': 'Buy Now',
    'basket.simulate_payment': 'Simulate Stripe payment',
    'basket.checkout_note': 'Checkout uses USD. Stripe has a $0.50 minimum charge; orders below that include a top-up to the minimum.',
    'basket.allowance_summary_label': '{days}-day allowance',
    'basket.allowance_summary': '{count} selected {assetWord} already covered by a purchase in the last {days} days.',
    'basket.allowance_summary_action': 'Use the original order page or delivery email instead of repurchasing covered files.',
    'basket.allowance_badge': 'Covered by {days}-day download allowance',
    'basket.allowance_note': 'Purchased {date}. Covered until {until}.',
    'basket.allowance_review_checkout': '{count} selected {assetWord} already covered by the {days}-day download allowance. Remove covered files or use the original order page before buying again.',
    'trust.eyebrow': 'Buyer notes',
    'trust.checkout_title': 'Before you pay',
    'trust.order_title': 'Keep for recovery',
    'trust.stripe_payment': 'Stripe handles the card payment and receipt; PhotosByElie handles private file delivery.',
    'trust.recovery': 'Your order ID and checkout email recover downloads on the order page.',
    'trust.license_short': 'Personal print and web use is included; commercial, resale, and AI-training use needs written approval.',
    'trust.support_short': 'If delivery looks wrong, contact support with the order ID before repurchasing.',
    'trust.receipt_record': 'Stripe\'s receipt is your payment record. This order page is the delivery record.',
    'trust.download_window': 'Download rows show each file\'s availability window when the Worker provides one.',
    'trust.support_order': 'For expired links, duplicate charges, or missing files, contact support with the order ID and checkout email.',
    'browser_warning.title': 'Open in your browser',
    'browser_warning.checkout': 'Pinterest and social-app browsers can block payment redirects and downloads. Open this page in Safari or Chrome before checkout.',
    'browser_warning.download': 'Pinterest and social-app browsers can block file downloads. Open this order in Safari or Chrome, then download your files.',
    'browser_warning.open': 'Open in browser',
    'browser_warning.open_order': 'Open order in browser',
    'browser_warning.copy': 'Copy link',
    'browser_warning.copied': 'Link copied. Open it in Safari or Chrome.',
    'browser_warning.copy_failed': 'Copy the page URL and open it in Safari or Chrome.',
    'basket.assets_total': '{count} {assetWord}, {total}',
    'basket.asset_singular': 'asset',
    'basket.asset_plural': 'assets',
    'basket.order_id': 'Order ID',
    'basket.photos': 'Photos',
    'basket.assets': 'Assets',
    'basket.original_subtotal': 'Original subtotal',
    'basket.draft_total': 'Draft total',
    'basket.discount_code': 'Discount code',
    'basket.discount': 'Discount',
    'basket.discounted_subtotal': 'Discounted subtotal',
    'basket.minimum_charge': 'Stripe minimum',
    'basket.minimum_adjustment': 'Minimum top-up',
    'basket.payable_total': 'Payable total',
    'basket.collections': 'Collections',
    'basket.checkout_needs_asset': 'Checkout needs at least one digital asset in the basket.',
    'basket.enter_email': 'Enter a buyer email before starting checkout.',
    'basket.checking_delivery': 'Checking delivery files before opening Stripe...',
    'basket.unavailable_removed_review': 'Unavailable delivery choices were removed. Review the updated basket, then choose Buy Now again.',
    'basket.creating_checkout': 'Preparing secure Stripe checkout...',
    'basket.opening_stripe': 'Opening Stripe Checkout...',
    'basket.mock_ready': 'Mock Checkout Session ready. Simulate Stripe payment to generate the ZIP.',
    'basket.simulating_payment': 'Simulating Stripe payment and generating the delivery ZIP...',
    'basket.mock_complete': 'Mock payment complete. Delivery ZIP generated.',
    'basket.item_removed': 'Item removed from basket.',
    'basket.item_singular': 'item',
    'basket.item_plural': 'items',
    'basket.choices_updated': '{title} asset choices updated.',
    'basket.no_assets_selected': '{title} has no selected assets. Use Remove to delete the photo.',
    'basket.remove': 'Remove',
    'liked.title': 'Liked',
    'liked.empty': 'No liked photos yet.',
    'liked.select_all_full': 'Select all Full',
    'liked.select_all_6': 'Select all 6 MP',
    'liked.select_all_3': 'Select all 3 MP',
    'liked.select_all_1': 'Select all 1 MP',
    'liked.select_all_option': 'Select all {option}',
    'liked.deselect_all_option': 'Deselect all {option}',
    'liked.selected_some': '{option} selected for {count} liked photo(s); {unavailable} unavailable.',
    'liked.selected_all': '{option} selected for {count} liked photo(s).',
    'liked.deselected_some': '{option} deselected for {count} liked photo(s); {unavailable} unavailable.',
    'liked.deselected_all': '{option} deselected for {count} liked photo(s).',
    'liked.unlike': 'Unlike',
    'liked.removed': '{title} removed from liked photos.',
    'liked.added_to_basket': '{title} asset choices added to basket.',
    'liked.no_assets_selected': '{title} has no selected assets.',
    'order.title': 'Order',
    'order.checkout': 'Checkout',
    'order.loading': 'Loading order',
    'order.checking_phase': 'Checking order phase',
    'order.checking_worker': 'Checking the checkout Worker for order status.',
    'order.payment': 'Payment',
    'order.stripe': 'Stripe',
    'order.build_zip': 'Prepare files',
    'order.private_r2': 'Private R2',
    'order.download': 'Download',
    'order.ready_label': 'Ready',
    'order.waiting_payment': 'Waiting for payment',
    'order.building_zip': 'Preparing delivery files',
    'order.delivery_blocked': 'Delivery blocked',
    'order.ready_download': 'Ready to download',
    'order.phase_3': 'Phase 3 of 3',
    'order.ready_message': 'Payment is complete and your private delivery files are ready.',
    'order.email_notice_title': 'Delivery email sent',
    'order.email_notice_body': 'We also sent one download link per purchased item by email. If it does not appear within a few minutes, check Spam or Junk for Photos By Elie downloads are ready.',
    'order.email_notice_fallback_title': 'Keep this order page',
    'order.email_notice_fallback_body': 'Your downloads are ready here. If the delivery email is slow to arrive, keep this page open and check Spam or Junk as well.',
    'order.resend_email': 'Resend download email',
    'order.resending_email': 'Sending delivery email...',
    'order.email_resent': 'Delivery email sent again. Check your inbox, Spam, or Junk.',
    'order.email_resend_failed': 'Could not resend delivery email: {message}',
    'order.account_history_title': 'All purchased photos',
    'order.account_history_body': 'Orders attached to this signed-in email. Open an order to download; resend sends instructions to the original checkout email.',
    'order.account_history_empty': 'No signed-in order history was found.',
    'order.account_history_current': 'Current order',
    'order.resend_original_email': 'Resend instructions',
    'order.account_history_resent': 'Download instructions sent to {email}.',
    'order.account_history_resend_failed': 'Could not resend instructions: {message}',
    'order.blocked_phase_2': 'Blocked after Phase 2',
    'order.delivery_attention': 'Delivery needs attention',
    'order.delivery_failed': 'Payment is complete, but the Worker could not prepare one or more delivery files.',
    'order.phase_2': 'Phase 2 of 3',
    'order.building_message': 'Payment is complete. We are preparing your private files now; this can take up to 10 minutes for full-resolution or multi-photo orders.',
    'order.delivery_files': 'Delivery files',
    'order.files_preparing': 'Preparing each file',
    'order.files_ready': 'Download each file separately',
    'order.files_ready_count': '{ready} of {total} files ready',
    'order.download_available_until': 'Available until {date}',
    'order.download_all_files': 'Download all files',
    'order.open_browser_to_download': 'Open browser to download',
    'order.download_file': 'Download',
    'order.file_ready': 'Ready',
    'order.file_preparing': 'Preparing',
    'order.file_needs_attention': 'Needs attention',
    'order.file_downloading': 'Downloading...',
    'order.file_downloaded': 'Downloaded',
    'order.file_failed': 'Failed:',
    'order.payment_not_confirmed': 'Payment not confirmed',
    'order.payment_message': 'Payment is being confirmed by Stripe. This usually takes a few seconds; the page will refresh automatically.',
    'order.details_needed': 'Order details needed',
    'order.details_message': 'Enter the order ID from your receipt and the checkout email to recover downloads.',
    'order.lookup_order_id': 'Order ID',
    'order.lookup_email': 'Checkout email',
    'order.lookup_button': 'Find order',
    'order.lookup_required': 'Enter both the order ID and checkout email.',
    'order.refreshing': 'Refreshing order...',
    'order.refreshed': 'Order refreshed.',
    'order.cached': 'Showing cached local order. Download uses the generated ZIP file on disk.',
    'order.unavailable': 'Order unavailable',
    'order.could_not_load': 'Could not load order from the checkout Worker.',
    'order.download_requested_local': 'Download requested. If the in-app browser does not show a download, use the Local ZIP path below.',
    'order.download_requested_worker': 'Download requested from the checkout Worker.',
    'order.local_path_copied': 'Local ZIP path copied.',
    'order.copy_failed_select': 'ZIP path selected. Press Command-C to copy it.',
    'order.zip_location': 'ZIP location',
    'order.status': 'Status',
    'order.email': 'Email',
    'order.total': 'Total',
    'order.paid': 'Paid',
    'order.mode': 'Mode',
    'order.delivery_note': 'Delivery note',
    'order.local_zip': 'Local ZIP',
    'order.delivery_zip': 'Delivery ZIP',
    'support.eyebrow': 'Buyer support',
    'support.title': 'Support and license',
    'support.lead': 'Stripe is the payment receipt. PhotosByElie is the delivery and recovery record for private photo downloads.',
    'support.recover_order': 'Recover an order',
    'support.email_support': 'Email support',
    'support.payment_eyebrow': 'Payment',
    'support.payment_title': 'Receipts and card statements',
    'support.payment_1': 'Stripe processes card payments and sends the payment receipt when receipts are enabled.',
    'support.payment_2': 'Card statements should show PHOTOSELIE* DOWNLOAD for new checkout payments.',
    'support.payment_3': 'Keep the Stripe receipt plus your PhotosByElie order ID; the order ID is what recovers downloads.',
    'support.delivery_eyebrow': 'Delivery',
    'support.delivery_title': 'Download recovery',
    'support.delivery_1': 'After payment, the order page prepares private download links for each purchased file.',
    'support.delivery_2': 'Use the order ID and checkout email on the order page if you need to redownload later.',
    'support.delivery_3': 'Current download links can expire or hit a download limit; support can review a paid order and refresh delivery when appropriate.',
    'support.license_eyebrow': 'License',
    'support.license_title': 'Included use',
    'support.license_1': 'Digital purchases include personal print and personal web use for the buyer.',
    'support.license_2': 'Commercial use, resale, redistribution, stock licensing, merchandise, and AI-training use need written approval first.',
    'support.license_3': 'Ask before using a file for a client, product, paid campaign, or public commercial project.',
    'support.refunds_eyebrow': 'Help',
    'support.refunds_title': 'Refund and delivery issues',
    'support.refunds_1': 'If a file cannot be delivered, a duplicate charge appears, or the wrong resolution was purchased by mistake, email support with the order ID.',
    'support.refunds_2': 'Refunds are reviewed case by case. Delivery failures and duplicate charges are treated as support issues first.',
    'support.refunds_3': 'Use the Email support button from your order page for delivery help.',
    'support.credits_title': 'Site credits',
    'support.credits_copy_prefix': 'Photos By Elie is photographed and curated by Elie Cohen. Website design, build, and ongoing maintenance by',
    'product.digital': 'Digital asset',
    'product.print': 'Print',
    'product.frame': 'Frame',
    'product.product': 'Product',
    'product.full': 'Full resolution',
    'product.full_detail': 'Original source file at native resolution',
    'product.jpg_6': 'JPG 6 MP',
    'product.jpg_6_detail': 'Long edge export for print and premium web',
    'product.jpg_3': 'JPG 3 MP',
    'product.jpg_3_detail': 'Listing, portfolio, and editorial web use',
    'product.jpg_1': 'JPG 1 MP',
    'product.jpg_1_detail': 'Small web preview and social draft use',
    'product.print_detail': 'Classic photo print',
    'product.no_frame': 'No frame',
    'product.white_frame': 'White frame',
    'product.black_frame': 'Black frame',
    'product.original': 'Original: {source}',
    'product.decrease_count': 'Decrease {label} count',
    'product.increase_count': 'Increase {label} count',
    'nav.real_estate': 'Real Estate',
    're.login.eyebrow': 'Private client access',
    're.login.title': 'Client login',
    're.login.username': 'Username',
    're.login.password': 'Password',
    're.login.legacy_password': 'Legacy password',
    're.login.show_password': 'Show password',
    're.login.hide_password': 'Hide password',
    're.login.submit': 'Log in',
    're.selection.label': 'Selection',
    're.selection.name': 'Selection name',
    're.hero.customer_review': '{name} review',
    're.hero.client_review': 'Client review',
    're.hero.title': 'Real estate selection',
    're.hero.description': 'Private media review workspace for project PDFs and slideshow delivery.',
    're.stats.gallery_totals': 'Gallery totals',
    're.stats.stills': 'Stills',
    're.stats.videos': 'Videos',
    're.stats.albums': 'Albums',
    're.stats.selections': 'Selections',
    're.cta.create_selection': '+ Create new selection',
    're.cta.first_selection': 'Create your first selection',
    're.help.button': 'Help',
    're.shelf.eyebrow': 'Produced so far',
    're.shelf.title': 'Your saved products',
    're.shelf.note': 'Open or download saved files on phone or desktop. You can capture, save, or share the files in the way that works best for you.',
    're.wizard.steps_label': 'Real estate review steps',
    're.wizard.back_shelf': 'Back to shelf',
    're.workbench.label': 'Real estate review workspace',
    're.controls.label': 'Review controls',
    're.step.shoots': 'Shoots',
    're.step.photos': 'Photos',
    're.step.titles': 'Titles',
    're.step.order': 'Order',
    're.step.output': 'Output',
    're.panel.shoots': 'Shoots',
    're.panel.filters': 'Filters',
    're.filter.search': 'Search',
    're.filter.search_placeholder': 'Title, file, or album',
    're.filter.sort': 'Sort',
    're.filter.card_size': 'Card size',
    're.filter.selected_only': 'Selected only',
    're.sort.album': 'Album order',
    're.sort.selected': 'Selected first',
    're.sort.file': 'File name',
    're.media.all': 'Photos + videos',
    're.density.compact': 'Compact',
    're.density.balanced': 'Balanced',
    're.density.large': 'Large',
    're.draft.title': 'Output draft',
    're.draft.empty': 'No selected media yet.',
    're.gallery.title': 'Media review',
    're.action.select_visible': 'Select visible',
    're.action.save_selection': 'Save selection',
    're.action.files_selected': 'files selected',
    're.action.clear_selected': 'Clear selected',
    're.action.sign_out': 'Sign out',
    're.action.cancel': 'Cancel',
    're.action.pick_photos': 'Pick photos',
    're.action.choose_output': 'Choose output',
    're.output.download_pdf': 'Download PDF',
    're.output.download_video': 'Download video',
    're.output.share_originals': 'Share originals ZIP',
    're.output.eyebrow': 'Step 5',
    're.output.title': 'Preview or download',
    're.output.note': 'Each selection includes both PDF and video formats. Preview either one, or download true PDF and video files on phone or desktop.',
    're.output.paper_size': 'PDF paper size',
    're.output.photo_seconds': 'Photo seconds in video',
    're.output.video_format': 'Video format',
    're.output.video_landscape': 'Landscape',
    're.output.video_portrait': 'Vertical',
    're.output.music_country': 'Music country',
    're.output.music_auto': 'Auto from project',
    're.output.watermark_text': 'Watermark text',
    're.output.watermark_enabled': 'Use watermark on PDF and video',
    're.output.preview_pdf': 'Preview PDF',
    're.output.preview_video': 'Preview video',
    're.output.download_everything': 'Download everything',
    're.output.download_everything_busy': 'Preparing everything...',
    're.status.ready': 'Ready',
    're.status.loading': 'Loading real-estate gallery...',
    're.status.choose_shoots': 'Choose shoots to begin.',
    're.status.choose_shoots_step': 'Choose the shoots you want to pick from.',
    're.status.click_media': 'Click media from {project} to select it. Shift-click selects a range.',
    're.status.selected_titles': 'Only the {count} selected media items are shown. Change titles only where needed.',
    're.status.select_before_titles': 'Select at least one photo or video before editing titles.',
    're.status.drag_selected': 'Drag the {count} selected media items into the order you want.',
    're.status.select_before_order': 'Select at least one photo or video before ordering.',
    're.status.ready_output': 'Ready for output: {summary}. Prepare the PDF and video, then choose Next to review finished products.',
    're.status.select_before_output': 'Select at least one photo or video before creating outputs.',
    're.progress.working': 'Working...',
    're.progress.done': 'Done',
    're.progress.needs_attention': 'Needs attention',
    're.dialog.close_preview': 'Close media preview',
    're.dialog.output_title': 'Output title',
    're.dialog.selected_for_output': 'Selected for output',
    're.help.eyebrow': 'New selection',
    're.help.title': 'How project outputs work',
    're.help.step1': 'Pick one or more shoots first; the Photos step shows only those media.',
    're.help.step2': 'Click photos or videos to select the ones to use.',
    're.help.step3': 'Go to Titles and change only the captions that should be different in the final product.',
    're.help.step4': 'Go to Order and drag the selected media into the PDF or video sequence.',
    're.help.step5': 'Go to Output to preview the PDF or video, then download the PDF or video file you need.',
    're.help.step6': 'Open or download the generated PDF and video files on phone or desktop; save or share them in the way that works best for you.',
    're.help.step7': 'Open a saved selection from the shelf when you want to resume or revise older work.',
    're.help.start': 'Start selecting',
    're.help.close': 'Close help',
    're.originals.eyebrow': 'Private originals',
    're.originals.title': 'Originals ZIP password',
    're.originals.cancel_zip': 'Cancel originals ZIP',
    're.originals.create_zip': 'Create ZIP',
  },
  fr: {
    'a11y.skip': 'Aller au contenu',
    'a11y.site_nav': 'Navigation du site',
    'a11y.footer_nav': 'Navigation du pied de page',
    'a11y.collection_pagination': 'Pagination des collections',
    'a11y.photo_navigation': 'Navigation photo',
    'a11y.like_photo': 'Aimer cette photo',
    'a11y.unlike_photo': 'Retirer des favoris',
    'a11y.back_to_top': 'Retour en haut',
    'a11y.open_liked': 'Ouvrir les favoris',
    'a11y.open_basket': 'Ouvrir le panier',
    'a11y.add_to_basket': 'Ajouter au panier',
    'a11y.remove_from_basket': 'Retirer du panier',
    'a11y.bottom_photo_actions': 'Actions photo',
    'a11y.gallery_filters': 'Filtres et tri de la galerie',
    'a11y.gallery_view_controls': 'Commandes d affichage de la galerie',
    'a11y.gallery_image_fit': 'Cadrage des images',
    'a11y.order_progress': 'Progression de la commande',
    'a11y.select_liked_resolutions': 'Choisir les resolutions des photos aimees',
    'nav.photos': 'Photos',
    'nav.gallery': 'Galerie',
    'nav.basket': 'Panier',
    'nav.liked': 'Favoris',
    'nav.collections': 'Collections',
    'nav.owner': 'Owner',
    'nav.support': 'Support et licence',
    'footer.credit_prefix': 'Creation et maintenance du site par',
    'theme.night': 'Nuit',
    'theme.day': 'Jour',
    'settings.open': 'Reglages',
    'settings.title': 'Reglages',
    'settings.close': 'Fermer les reglages',
    'settings.language': 'Langue',
    'settings.appearance': 'Apparence',
    'settings.transparency': 'Transparence',
    'settings.translucency': 'Translucidite',
    'settings.solid': 'Opaque',
    'settings.clear': 'Clair',
    'settings.sharp': 'Net',
    'settings.frosted': 'Floute',
    'account.open': 'Compte',
    'account.title': 'Compte',
    'account.close': 'Fermer le compte',
    'account.visitor_status': 'Parcourir en visiteur',
    'account.choose': 'Continuez sans connexion, ou verifiez votre email avec Google.',
    'account.continue_visitor': 'Continuer en visiteur',
    'account.continue_browsing': 'Continuer',
    'account.sign_up_google': 'Creer un compte avec Google',
    'account.sign_in_google': 'Connexion avec Google',
    'account.sign_out': 'Deconnexion',
    'account.signed_in': 'Connecte',
    'account.verified_email': 'Email verifie par Google.',
    'account.loading': 'Verification du compte...',
    'account.redirecting': 'Ouverture de la connexion Google...',
    'account.signing_out': 'Deconnexion...',
    'account.login_unavailable': 'La connexion Google n est pas disponible depuis cette page.',
    'account.session_failed': 'Impossible de verifier la session Google.',
    'account.memory_title': 'Profil enregistre',
    'account.memory_body': 'Les commandes et liens de telechargement viennent de l email verifie. Enregistrer aimees/panier copie les choix de ce navigateur dans le compte.',
    'account.memory_counts': '{likes} aimees · {basket} panier · {orders} commandes',
    'account.sync_now': 'Enregistrer aimees/panier',
    'account.sync_help': 'Enregistre les photos aimees et le panier de ce navigateur. Les commandes et liens de telechargement sont rattaches automatiquement a l email de paiement.',
    'account.open_liked': 'Voir les aimees',
    'account.open_basket': 'Voir le panier',
    'account.orders_title': 'Commandes et telechargements',
    'account.no_orders': 'Aucune commande n est encore enregistree pour ce compte.',
    'account.view_downloads': 'Ouvrir commande',
    'account.resend_downloads': 'Renvoyer instructions',
    'account.resend_unavailable': 'Renvoyer quand les fichiers sont prets',
    'account.order_resending': 'Envoi des instructions...',
    'account.order_resent': 'Instructions envoyees a {email}.',
    'account.order_resend_failed': 'Impossible de renvoyer : {message}',
    'account.order_ready': 'Pret',
    'account.order_pending': 'En attente',
    'account.profile_loaded': 'Commandes actualisees.',
    'account.profile_saved': 'Photos aimees et panier enregistres.',
    'account.profile_syncing': 'Mise a jour du compte...',
    'account.profile_failed': 'Impossible de mettre le compte a jour.',
    'home.lead': 'Une archive choisie de photos prises par Elie, avec galeries par pays et nouveaux apercus representatifs au fil du rail des collections.',
    'home.view_collections': 'Voir les collections',
    'home.collections': 'Collections',
    'home.discover': 'Rechercher des photos',
    'home.collection_filter': 'Collection',
    'home.results': 'Resultats de recherche',
    'home.loading_catalog': 'Chargement du catalogue...',
    'home.catalog_ready': '{count} photos pretes.',
    'home.showing_results': '{count} sur {total} photos.',
    'home.showing_matches': '{count} sur {total} resultats.',
    'home.no_matches': 'Aucune photo ne correspond aux filtres.',
    'home.show_more': 'Voir plus',
    'home.show_all': 'Tout voir',
    'home.see_more_count': 'Afficher {count} de plus',
    'home.see_all_count': 'Tout afficher {count}',
    'home.title_required': 'Le titre ne peut pas etre vide.',
    'home.saving_metadata': 'Enregistrement des metadonnees...',
    'home.metadata_saved': 'Metadonnees de {title} enregistrees.',
    'home.metadata_failed': 'Impossible d enregistrer les metadonnees.',
    'home.moved_blocked': '{title} deplace vers la corbeille.',
    'home.block_failed': 'Impossible de deplacer la photo vers la corbeille.',
    'home.discarded': '{title} supprime.',
    'home.discard_failed': 'Impossible de supprimer la photo.',
    'home.undo_failed': 'Impossible d annuler le dernier deplacement vers la corbeille.',
    'home.nothing_to_undo': 'Aucun deplacement local vers la corbeille a annuler.',
    'home.undo_done': 'Dernier deplacement vers la corbeille annule.',
    'home.owner_action_failed': 'Action Owner impossible.',
    'collection.france': 'France',
    'collection.usa': 'États-Unis',
    'collection.spain': 'Espagne',
    'collection.apple-2025-alhaurin-de-la-torre-sunset': '2025 Alhaurin de la Torre, coucher de soleil',
    'collection.apple-2025-cadiz': '2025 Cadix',
    'collection.apple-2025-cordoba-la-mezquita': '2025 Cordoue, la Mezquita',
    'collection.apple-2025-florence': '2025 Florence',
    'collection.apple-2025-fuengirola-moon-over-the-mediterranean': '2025 Fuengirola, lune sur la Mediterranee',
    'collection.apple-2025-madrid-real-palacio': '2025 Madrid, Palais royal',
    'collection.apple-2025-pisa': '2025 Pise',
    'collection.apple-2025-ronda': '2025 Ronda',
    'collection.apple-2025-san-gimignano': '2025 San Gimignano',
    'collection.apple-2025-seville': '2025 Seville',
    'collection.apple-2025-valencia-aquarium': '2025 Valence, aquarium',
    'collection.apple-2025-valencia-catedral': '2025 Valence, cathedrale',
    'collection.apple-2025-views-from-home-malaga-airport': '2025 Vue de chez nous, aeroport de Malaga',
    'collection.apple_2025_cordoba_la_mezquita': '2025 Cordoue, la Mezquita',
    'collection.apple-2026-malaga-museo-ruso': '2026 Malaga Musee Russe',
    'collection.apple-2026-nerja-caves': '2026 Grottes de Nerja',
    'collection.apple_2026_malaga_museo_ruso': '2026 Malaga Musee Russe',
    'collection.apple_2026_nerja_caves': '2026 Grottes de Nerja',
    'collection.mexico': 'Mexique',
    'collection.ai': 'Images IA',
    'collection.italy': 'Italie',
    'collection.portugal': 'Portugal',
    'collection.slovakia': 'Slovaquie',
    'collection.panoramas': 'Panoramas',
    'collection.video-trial': 'Essai video Cordoue',
    'common.back_to_collections': 'Retour aux collections',
    'common.back_to_gallery': 'Retour a la galerie',
    'common.back_to_search': 'Retour a la recherche',
    'common.previous': 'Precedent',
    'common.next': 'Suivant',
    'common.refresh': 'Actualiser',
    'common.photo': 'Photo',
    'common.photo_detail': 'Detail de la photo',
    'preview.full_height': 'Pleine hauteur',
    'preview.fit_width': 'Ajuster largeur',
    'gallery.grid': 'Grille',
    'gallery.fit': 'Ajuster',
    'gallery.fill': 'Remplir',
    'gallery.make_selection': 'Rechercher',
    'gallery.orientation': 'Orientation',
    'gallery.origin': 'Origine',
    'gallery.search': 'Recherche',
    'gallery.search_placeholder': 'Titre ou mot-cle',
    'gallery.date_from': 'Date debut',
    'gallery.date_to': 'Date fin',
    'gallery.any_date': 'Toute date',
    'gallery.media': 'Media',
    'gallery.all_media': 'Tous medias',
    'gallery.photos': 'Photos',
    'gallery.videos': 'Videos',
    'gallery.color_mood': 'Ambiance couleur',
    'gallery.subject': 'Sujet',
    'gallery.sort': 'Tri',
    'gallery.all': 'Tout',
    'gallery.pano': 'Pano',
    'gallery.landscape': 'Paysage',
    'gallery.portrait': 'Portrait',
    'gallery.square': 'Carré',
    'gallery.min_size': 'Taille min',
    'gallery.min_duration': 'Duree min',
    'gallery.any_size': 'Toute taille',
    'gallery.any_duration': 'Toute duree',
    'gallery.size_1mp': '1 MP+',
    'gallery.size_3mp': '3 MP+',
    'gallery.size_6mp': '6 MP+',
    'gallery.size_10mp': '10 MP+',
    'gallery.size_20mp': '20 MP+',
    'gallery.duration_5s': '5 s+',
    'gallery.duration_10s': '10 s+',
    'gallery.duration_20s': '20 s+',
    'gallery.duration_30s': '30 s+',
    'gallery.duration_60s': '60 s+',
    'origin.camera': 'Photo camera',
    'origin.ai': 'Image IA',
    'gallery.warm': 'Chaud',
    'gallery.cool': 'Froid',
    'gallery.neutral': 'Neutre',
    'gallery.vivid': 'Vif',
    'gallery.architecture': 'Architecture',
    'gallery.water': 'Eau/cote',
    'gallery.art': 'Art/musee',
    'gallery.people': 'Personnes',
    'gallery.nature': 'Nature',
    'gallery.city': 'Ville/voyage',
    'gallery.newest': 'Plus recent',
    'gallery.oldest': 'Plus ancien',
    'gallery.collection_order': 'Ordre collection',
    'gallery.title': 'Titre',
    'gallery.largest_mp': 'Plus de MP',
    'gallery.smallest_mp': 'Moins de MP',
    'gallery.longest_duration': 'Plus long',
    'gallery.shortest_duration': 'Plus court',
    'gallery.highest_price': 'Prix haut',
    'gallery.lowest_price': 'Prix bas',
    'gallery.mood_photos_only': 'Ambiance couleur disponible pour les photos seulement',
    'gallery.clear': 'Effacer',
    'gallery.no_filter_matches': 'Aucune photo ne correspond aux filtres',
    'gallery.no_visible': 'Aucune photo visible localement dans cette collection',
    'gallery.clear_filters': 'Effacer les filtres',
    'gallery.adjust_filters': 'Ajustez ou effacez les filtres pour revoir cette collection.',
    'gallery.showing_count': '{count} photos affichees.',
    'gallery.showing_filtered': '{count} sur {total} photos.',
    'gallery.showing_count_items': '{count} {items} affiches.',
    'gallery.showing_filtered_items': '{count} sur {total} {items}.',
    'gallery.media_photos': 'photos',
    'gallery.media_videos': 'videos',
    'gallery.media_items': 'medias',
    'gallery.reserve_available': '{status} Le remplissage de reserve est disponible.',
    'detail.pick_resolution': 'Choisir une resolution',
    'detail.total_selected': 'Total choisi :',
    'detail.archive_reset_title': 'Reinitialisation de l archive',
    'detail.no_published_meta': '{collection} / Aucune photo publiee pour le moment',
    'detail.no_published': 'Aucune photo publiee pour le moment',
    'detail.rebuilding': 'Cette galerie est reconstruite depuis l archive Saturn.',
    'detail.mp_verified': '{mp} MP verifies',
    'detail.info': 'Infos',
    'detail.shortcuts': 'Raccourcis :',
    'detail.like': 'favori',
    'detail.prev_next': 'precedent/suivant',
    'detail.full_screen': 'plein ecran',
    'detail.hide': 'masquer',
    'detail.undo': 'annuler',
    'detail.open_full_screen': 'Fermer l apercu plein ecran pour {title}',
    'detail.added_liked': '{title} ajoute aux favoris.',
    'detail.removed_liked': '{title} retire des favoris.',
    'detail.removed_basket': '{title} retire du panier.',
    'detail.no_selection': 'Aucune selection dans le panier pour cette photo.',
    'detail.saved': 'Selections de commande enregistrees pour {title}.',
    'detail.count': 'Quantite',
    'detail.frame': 'Cadre',
    'basket.title': 'Panier',
    'basket.empty': 'Votre panier est vide.',
    'basket.order_intent': 'Intention de commande',
    'basket.confirm_assets': 'Confirmer les fichiers numeriques',
    'basket.license_note': 'Verifiez vos fichiers numeriques avant le checkout. L usage personnel pour impression et web est inclus; les usages commerciaux, la revente et l entrainement IA demandent une autorisation ecrite.',
    'basket.buyer_email': 'Email acheteur',
    'basket.pay_guest': 'Acheter',
    'basket.simulate_payment': 'Simuler le paiement Stripe',
    'basket.checkout_note': 'Le checkout utilise l USD. Stripe impose un minimum de $0.50; les commandes plus basses ajoutent la difference.',
    'basket.allowance_summary_label': 'Autorisation {days} jours',
    'basket.allowance_summary': '{count} {assetWord} selectionne(s) sont deja couverts par un achat des {days} derniers jours.',
    'basket.allowance_summary_action': 'Utilisez la page de commande ou l email de livraison original au lieu de racheter ces fichiers.',
    'basket.allowance_badge': 'Couvert par l autorisation de telechargement {days} jours',
    'basket.allowance_note': 'Achete le {date}. Couvert jusqu au {until}.',
    'basket.allowance_review_checkout': '{count} {assetWord} selectionne(s) sont deja couverts par l autorisation de telechargement {days} jours. Retirez ces fichiers ou utilisez la page de commande originale avant de racheter.',
    'trust.eyebrow': 'Notes acheteur',
    'trust.checkout_title': 'Avant de payer',
    'trust.order_title': 'A garder pour recuperer',
    'trust.stripe_payment': 'Stripe gere le paiement par carte et le recu; PhotosByElie gere la livraison privee des fichiers.',
    'trust.recovery': 'Le numero de commande et l email de checkout recuperent les telechargements sur la page commande.',
    'trust.license_short': 'L usage personnel pour impression et web est inclus; les usages commerciaux, la revente et l entrainement IA demandent une autorisation ecrite.',
    'trust.support_short': 'Si la livraison semble incorrecte, contactez le support avec le numero de commande avant de racheter.',
    'trust.receipt_record': 'Le recu Stripe est votre preuve de paiement. Cette page commande est le dossier de livraison.',
    'trust.download_window': 'Les lignes de telechargement affichent la fenetre de disponibilite quand le Worker la fournit.',
    'trust.support_order': 'Pour des liens expires, des frais en double ou des fichiers manquants, contactez le support avec le numero de commande et l email de checkout.',
    'browser_warning.title': 'Ouvrir dans votre navigateur',
    'browser_warning.checkout': 'Les navigateurs integres Pinterest et reseaux sociaux peuvent bloquer les redirections de paiement et les telechargements. Ouvrez cette page dans Safari ou Chrome avant le checkout.',
    'browser_warning.download': 'Les navigateurs integres Pinterest et reseaux sociaux peuvent bloquer les fichiers. Ouvrez cette commande dans Safari ou Chrome, puis telechargez vos fichiers.',
    'browser_warning.open': 'Ouvrir dans le navigateur',
    'browser_warning.open_order': 'Ouvrir la commande',
    'browser_warning.copy': 'Copier le lien',
    'browser_warning.copied': 'Lien copie. Ouvrez-le dans Safari ou Chrome.',
    'browser_warning.copy_failed': 'Copiez l URL de la page et ouvrez-la dans Safari ou Chrome.',
    'basket.assets_total': '{count} {assetWord}, {total}',
    'basket.asset_singular': 'fichier',
    'basket.asset_plural': 'fichiers',
    'basket.order_id': 'Commande',
    'basket.photos': 'Photos',
    'basket.assets': 'Fichiers',
    'basket.original_subtotal': 'Sous-total original',
    'basket.draft_total': 'Total brouillon',
    'basket.discount_code': 'Code remise',
    'basket.discount': 'Remise',
    'basket.discounted_subtotal': 'Sous-total remise',
    'basket.minimum_charge': 'Minimum Stripe',
    'basket.minimum_adjustment': 'Complement minimum',
    'basket.payable_total': 'Total a payer',
    'basket.collections': 'Collections',
    'basket.checkout_needs_asset': 'Le checkout demande au moins un fichier numerique dans le panier.',
    'basket.enter_email': 'Saisissez un email acheteur avant de lancer le checkout.',
    'basket.checking_delivery': 'Verification des fichiers de livraison avant ouverture de Stripe...',
    'basket.unavailable_removed_review': 'Les choix de livraison indisponibles ont ete retires. Verifiez le panier mis a jour, puis choisissez Acheter.',
    'basket.creating_checkout': 'Preparation du checkout Stripe securise...',
    'basket.opening_stripe': 'Ouverture de Stripe Checkout...',
    'basket.mock_ready': 'Session Checkout mock prete. Simulez le paiement Stripe pour generer le ZIP.',
    'basket.simulating_payment': 'Simulation du paiement Stripe et generation du ZIP de livraison...',
    'basket.mock_complete': 'Paiement mock termine. ZIP de livraison genere.',
    'basket.item_removed': 'Element retire du panier.',
    'basket.item_singular': 'element',
    'basket.item_plural': 'elements',
    'basket.choices_updated': 'Choix de fichiers mis a jour pour {title}.',
    'basket.no_assets_selected': '{title} n a aucun fichier choisi. Utilisez Retirer pour supprimer la photo.',
    'basket.remove': 'Retirer',
    'liked.title': 'Favoris',
    'liked.empty': 'Aucune photo favorite pour le moment.',
    'liked.select_all_full': 'Tout choisir en Full',
    'liked.select_all_6': 'Tout choisir en 6 MP',
    'liked.select_all_3': 'Tout choisir en 3 MP',
    'liked.select_all_1': 'Tout choisir en 1 MP',
    'liked.select_all_option': 'Tout choisir en {option}',
    'liked.deselect_all_option': 'Tout retirer en {option}',
    'liked.selected_some': '{option} choisi pour {count} photo(s) favorite(s); {unavailable} indisponible(s).',
    'liked.selected_all': '{option} choisi pour {count} photo(s) favorite(s).',
    'liked.deselected_some': '{option} retire pour {count} photo(s) favorite(s); {unavailable} indisponible(s).',
    'liked.deselected_all': '{option} retire pour {count} photo(s) favorite(s).',
    'liked.unlike': 'Retirer',
    'liked.removed': '{title} retire des favoris.',
    'liked.added_to_basket': 'Choix de fichiers ajoutes au panier pour {title}.',
    'liked.no_assets_selected': '{title} n a aucun fichier choisi.',
    'order.title': 'Commande',
    'order.checkout': 'Checkout',
    'order.loading': 'Chargement de la commande',
    'order.checking_phase': 'Verification de la phase',
    'order.checking_worker': 'Verification du statut avec le Worker checkout.',
    'order.payment': 'Paiement',
    'order.stripe': 'Stripe',
    'order.build_zip': 'Preparer fichiers',
    'order.private_r2': 'R2 prive',
    'order.download': 'Telechargement',
    'order.ready_label': 'Pret',
    'order.waiting_payment': 'Paiement en attente',
    'order.building_zip': 'Preparation des fichiers',
    'order.delivery_blocked': 'Livraison bloquee',
    'order.ready_download': 'Pret a telecharger',
    'order.phase_3': 'Phase 3 sur 3',
    'order.ready_message': 'Le paiement est termine et vos fichiers prives sont prets.',
    'order.email_notice_title': 'Email de livraison envoye',
    'order.email_notice_body': 'Nous avons aussi envoye un lien de telechargement par article achete. S il n apparait pas dans quelques minutes, verifiez Spam ou Indesirables pour Photos By Elie downloads are ready.',
    'order.email_notice_fallback_title': 'Gardez cette page de commande',
    'order.email_notice_fallback_body': 'Vos telechargements sont prets ici. Si l email de livraison tarde, gardez cette page ouverte et verifiez aussi Spam ou Indesirables.',
    'order.resend_email': 'Renvoyer l email',
    'order.resending_email': 'Envoi de l email de livraison...',
    'order.email_resent': 'Email de livraison renvoye. Verifiez votre boite, Spam ou Indesirables.',
    'order.email_resend_failed': 'Impossible de renvoyer l email : {message}',
    'order.account_history_title': 'Toutes les photos achetees',
    'order.account_history_body': 'Commandes rattachees a cet email connecte. Ouvrez une commande pour telecharger; renvoyer envoie les instructions a l email de paiement original.',
    'order.account_history_empty': 'Aucun historique de commandes connecte trouve.',
    'order.account_history_current': 'Commande actuelle',
    'order.resend_original_email': 'Renvoyer instructions',
    'order.account_history_resent': 'Instructions envoyees a {email}.',
    'order.account_history_resend_failed': 'Impossible de renvoyer : {message}',
    'order.blocked_phase_2': 'Bloque apres la phase 2',
    'order.delivery_attention': 'Livraison a verifier',
    'order.delivery_failed': 'Le paiement est termine, mais le Worker n a pas pu preparer un ou plusieurs fichiers.',
    'order.phase_2': 'Phase 2 sur 3',
    'order.building_message': 'Le paiement est termine. Nous preparons vos fichiers prives; cela peut prendre jusqu a 10 minutes pour les commandes en pleine resolution ou avec plusieurs photos.',
    'order.delivery_files': 'Fichiers de livraison',
    'order.files_preparing': 'Preparation de chaque fichier',
    'order.files_ready': 'Telecharger chaque fichier separement',
    'order.files_ready_count': '{ready} fichier(s) sur {total} pret(s)',
    'order.download_available_until': 'Disponible jusqu au {date}',
    'order.download_all_files': 'Tout telecharger',
    'order.open_browser_to_download': 'Ouvrir navigateur',
    'order.download_file': 'Telecharger',
    'order.file_ready': 'Pret',
    'order.file_preparing': 'Preparation',
    'order.file_needs_attention': 'A verifier',
    'order.file_downloading': 'Telechargement...',
    'order.file_downloaded': 'Telecharge',
    'order.file_failed': 'Echec :',
    'order.payment_not_confirmed': 'Paiement non confirme',
    'order.payment_message': 'Stripe confirme le paiement. Cela prend generalement quelques secondes; la page s actualise automatiquement.',
    'order.details_needed': 'Details de commande requis',
    'order.details_message': 'Saisissez le numero de commande du recu et l email de checkout pour recuperer les telechargements.',
    'order.lookup_order_id': 'Numero de commande',
    'order.lookup_email': 'Email checkout',
    'order.lookup_button': 'Trouver commande',
    'order.lookup_required': 'Saisissez le numero de commande et l email de checkout.',
    'order.refreshing': 'Actualisation de la commande...',
    'order.refreshed': 'Commande actualisee.',
    'order.cached': 'Commande locale en cache affichee. Le telechargement utilise le ZIP genere sur disque.',
    'order.unavailable': 'Commande indisponible',
    'order.could_not_load': 'Impossible de charger la commande depuis le Worker checkout.',
    'order.download_requested_local': 'Telechargement demande. Si le navigateur integre ne montre pas le telechargement, utilisez le chemin ZIP local ci-dessous.',
    'order.download_requested_worker': 'Telechargement demande depuis le Worker checkout.',
    'order.local_path_copied': 'Chemin ZIP local copie.',
    'order.copy_failed_select': 'Chemin ZIP selectionne. Appuyez sur Command-C pour le copier.',
    'order.zip_location': 'Emplacement ZIP',
    'order.status': 'Statut',
    'order.email': 'Email',
    'order.total': 'Total',
    'order.paid': 'Paye',
    'order.mode': 'Mode',
    'order.delivery_note': 'Note de livraison',
    'order.local_zip': 'ZIP local',
    'order.delivery_zip': 'ZIP de livraison',
    'support.eyebrow': 'Support acheteur',
    'support.title': 'Support et licence',
    'support.lead': 'Stripe est le recu de paiement. PhotosByElie est le dossier de livraison et de recuperation des telechargements prives.',
    'support.recover_order': 'Recuperer une commande',
    'support.email_support': 'Email support',
    'support.payment_eyebrow': 'Paiement',
    'support.payment_title': 'Recus et releves carte',
    'support.payment_1': 'Stripe traite les paiements par carte et envoie le recu quand les recus sont actives.',
    'support.payment_2': 'Les releves carte devraient afficher PHOTOSELIE* DOWNLOAD pour les nouveaux paiements checkout.',
    'support.payment_3': 'Gardez le recu Stripe et votre numero de commande PhotosByElie; le numero de commande recupere les telechargements.',
    'support.delivery_eyebrow': 'Livraison',
    'support.delivery_title': 'Recuperation des telechargements',
    'support.delivery_1': 'Apres paiement, la page commande prepare des liens de telechargement prives pour chaque fichier achete.',
    'support.delivery_2': 'Utilisez le numero de commande et l email de checkout sur la page commande pour retelecharger plus tard.',
    'support.delivery_3': 'Les liens actuels peuvent expirer ou atteindre une limite; le support peut verifier une commande payee et reactiver la livraison si approprie.',
    'support.license_eyebrow': 'Licence',
    'support.license_title': 'Usage inclus',
    'support.license_1': 'Les achats numeriques incluent l usage personnel pour impression et web par l acheteur.',
    'support.license_2': 'Usage commercial, revente, redistribution, licence stock, produits derives et entrainement IA demandent une autorisation ecrite avant usage.',
    'support.license_3': 'Demandez avant d utiliser un fichier pour un client, un produit, une campagne payante ou un projet commercial public.',
    'support.refunds_eyebrow': 'Aide',
    'support.refunds_title': 'Remboursements et problemes de livraison',
    'support.refunds_1': 'Si un fichier ne peut pas etre livre, si un frais en double apparait, ou si une mauvaise resolution a ete achetee par erreur, envoyez un email avec le numero de commande.',
    'support.refunds_2': 'Les remboursements sont examines au cas par cas. Les echecs de livraison et frais en double sont traites comme problemes de support en premier.',
    'support.refunds_3': 'Utilisez le bouton Email support depuis votre page commande pour l aide livraison.',
    'support.credits_title': 'Credits du site',
    'support.credits_copy_prefix': 'Photos By Elie est photographie et selectionne par Elie Cohen. Conception, creation et maintenance continue du site par',
    'product.digital': 'Fichier numerique',
    'product.print': 'Tirage',
    'product.frame': 'Cadre',
    'product.product': 'Produit',
    'product.full': 'Resolution complete',
    'product.full_detail': 'Fichier source original a resolution native',
    'product.jpg_6': 'JPG 6 MP',
    'product.jpg_6_detail': 'Export grand cote pour tirage et web premium',
    'product.jpg_3': 'JPG 3 MP',
    'product.jpg_3_detail': 'Usage listing, portfolio et web editorial',
    'product.jpg_1': 'JPG 1 MP',
    'product.jpg_1_detail': 'Petit apercu web et brouillon social',
    'product.print_detail': 'Tirage photo classique',
    'product.no_frame': 'Sans cadre',
    'product.white_frame': 'Cadre blanc simple',
    'product.black_frame': 'Cadre noir simple',
    'product.original': 'Original : {source}',
    'product.decrease_count': 'Diminuer la quantite {label}',
    'product.increase_count': 'Augmenter la quantite {label}',
    'nav.real_estate': 'Immobilier',
    're.login.eyebrow': 'Acces client prive',
    're.login.title': 'Connexion client',
    're.login.username': 'Nom d utilisateur',
    're.login.password': 'Mot de passe',
    're.login.legacy_password': 'Ancien mot de passe',
    're.login.show_password': 'Afficher le mot de passe',
    're.login.hide_password': 'Masquer le mot de passe',
    're.login.submit': 'Connexion',
    're.selection.label': 'Selection',
    're.selection.name': 'Nom de la selection',
    're.hero.customer_review': 'Revue {name}',
    're.hero.client_review': 'Revue client',
    're.hero.title': 'Selection immobiliere',
    're.hero.description': 'Espace prive de revue media pour livrer les PDF projet et diaporamas.',
    're.stats.gallery_totals': 'Totaux de galerie',
    're.stats.stills': 'Photos',
    're.stats.videos': 'Videos',
    're.stats.albums': 'Albums',
    're.stats.selections': 'Selections',
    're.cta.create_selection': '+ Creer une selection',
    're.cta.first_selection': 'Creer votre premiere selection',
    're.help.button': 'Aide',
    're.shelf.eyebrow': 'Deja produits',
    're.shelf.title': 'Vos produits enregistres',
    're.shelf.note': 'Ouvrez ou telechargez les fichiers enregistres sur telephone ou ordinateur. Enregistrez-les ou partagez-les de la maniere qui vous convient.',
    're.wizard.steps_label': 'Etapes de revue immobiliere',
    're.wizard.back_shelf': 'Retour au rayon',
    're.workbench.label': 'Espace de revue immobiliere',
    're.controls.label': 'Commandes de revue',
    're.step.shoots': 'Shoots',
    're.step.photos': 'Photos',
    're.step.titles': 'Titres',
    're.step.order': 'Ordre',
    're.step.output': 'Sortie',
    're.panel.shoots': 'Shoots',
    're.panel.filters': 'Filtres',
    're.filter.search': 'Recherche',
    're.filter.search_placeholder': 'Titre, fichier ou album',
    're.filter.sort': 'Tri',
    're.filter.card_size': 'Taille des cartes',
    're.filter.selected_only': 'Selection seulement',
    're.sort.album': 'Ordre album',
    're.sort.selected': 'Selection d abord',
    're.sort.file': 'Nom de fichier',
    're.media.all': 'Photos + videos',
    're.density.compact': 'Compact',
    're.density.balanced': 'Equilibre',
    're.density.large': 'Grand',
    're.draft.title': 'Brouillon de sortie',
    're.draft.empty': 'Aucun media selectionne.',
    're.gallery.title': 'Revue media',
    're.action.select_visible': 'Selectionner visibles',
    're.action.save_selection': 'Enregistrer la selection',
    're.action.files_selected': 'fichiers selectionnes',
    're.action.clear_selected': 'Effacer selection',
    're.action.sign_out': 'Deconnexion',
    're.action.cancel': 'Annuler',
    're.action.pick_photos': 'Choisir photos',
    're.action.choose_output': 'Choisir sortie',
    're.output.download_pdf': 'Telecharger PDF',
    're.output.download_video': 'Telecharger video',
    're.output.share_originals': 'Partager ZIP originaux',
    're.output.eyebrow': 'Etape 5',
    're.output.title': 'Previsualiser ou telecharger',
    're.output.note': 'Chaque selection inclut les formats PDF et video. Previsualisez l un ou l autre, ou telechargez de vrais fichiers PDF et video sur telephone ou ordinateur.',
    're.output.paper_size': 'Format papier PDF',
    're.output.photo_seconds': 'Secondes par photo en video',
    're.output.video_format': 'Format video',
    're.output.video_landscape': 'Horizontal',
    're.output.video_portrait': 'Vertical',
    're.output.music_country': 'Pays de la musique',
    're.output.music_auto': 'Auto depuis le projet',
    're.output.watermark_text': 'Texte du filigrane',
    're.output.watermark_enabled': 'Utiliser le filigrane sur PDF et video',
    're.output.preview_pdf': 'Previsualiser PDF',
    're.output.preview_video': 'Previsualiser video',
    're.output.download_everything': 'Tout telecharger',
    're.output.download_everything_busy': 'Preparation de tout...',
    're.status.ready': 'Pret',
    're.status.loading': 'Chargement de la galerie immobiliere...',
    're.status.choose_shoots': 'Choisissez des shoots pour commencer.',
    're.status.choose_shoots_step': 'Choisissez les shoots dans lesquels piocher.',
    're.status.click_media': 'Cliquez les medias de {project} pour les selectionner. Maj-clic selectionne une plage.',
    're.status.selected_titles': 'Seuls les {count} medias selectionnes sont affiches. Modifiez les titres seulement si necessaire.',
    're.status.select_before_titles': 'Selectionnez au moins une photo ou video avant de modifier les titres.',
    're.status.drag_selected': 'Glissez les {count} medias selectionnes dans l ordre voulu.',
    're.status.select_before_order': 'Selectionnez au moins une photo ou video avant de definir l ordre.',
    're.status.ready_output': 'Pret pour la sortie : {summary}. Preparez le PDF et la video, puis choisissez Suivant pour verifier les produits finis.',
    're.status.select_before_output': 'Selectionnez au moins une photo ou video avant de creer les sorties.',
    're.progress.working': 'Travail en cours...',
    're.progress.done': 'Termine',
    're.progress.needs_attention': 'A verifier',
    're.dialog.close_preview': 'Fermer la previsualisation media',
    're.dialog.output_title': 'Titre de sortie',
    're.dialog.selected_for_output': 'Selectionne pour la sortie',
    're.help.eyebrow': 'Nouvelle selection',
    're.help.title': 'Fonctionnement des sorties projet',
    're.help.step1': 'Choisissez d abord un ou plusieurs shoots; l etape Photos montre seulement ces medias.',
    're.help.step2': 'Cliquez les photos ou videos a utiliser.',
    're.help.step3': 'Allez a Titres et changez seulement les legendes qui doivent differer dans le produit final.',
    're.help.step4': 'Allez a Ordre et glissez les medias selectionnes dans la sequence PDF ou video.',
    're.help.step5': 'Allez a Sortie pour previsualiser le PDF ou la video, puis telechargez le fichier necessaire.',
    're.help.step6': 'Ouvrez ou telechargez les fichiers PDF et video generes sur telephone ou ordinateur; enregistrez-les ou partagez-les comme vous preferez.',
    're.help.step7': 'Ouvrez une selection enregistree depuis le rayon pour reprendre ou modifier un travail ancien.',
    're.help.start': 'Commencer la selection',
    're.help.close': 'Fermer l aide',
    're.originals.eyebrow': 'Originaux prives',
    're.originals.title': 'Mot de passe ZIP originaux',
    're.originals.cancel_zip': 'Annuler le ZIP originaux',
    're.originals.create_zip': 'Creer ZIP',
  },
  es: {
    'a11y.skip': 'Saltar al contenido',
    'a11y.site_nav': 'Navegacion del sitio',
    'a11y.footer_nav': 'Navegacion del pie',
    'a11y.collection_pagination': 'Paginacion de colecciones',
    'a11y.photo_navigation': 'Navegacion de fotos',
    'a11y.like_photo': 'Marcar esta foto',
    'a11y.unlike_photo': 'Quitar de favoritos',
    'a11y.back_to_top': 'Volver arriba',
    'a11y.open_liked': 'Abrir favoritos',
    'a11y.open_basket': 'Abrir cesta',
    'a11y.add_to_basket': 'Agregar a la cesta',
    'a11y.remove_from_basket': 'Quitar de la cesta',
    'a11y.bottom_photo_actions': 'Acciones de foto',
    'a11y.gallery_filters': 'Filtros y orden de la galeria',
    'a11y.gallery_view_controls': 'Controles de vista de galeria',
    'a11y.gallery_image_fit': 'Ajuste de imagen de galeria',
    'a11y.order_progress': 'Progreso del pedido',
    'a11y.select_liked_resolutions': 'Seleccionar resoluciones de fotos favoritas',
    'nav.photos': 'Fotos',
    'nav.gallery': 'Galeria',
    'nav.basket': 'Cesta',
    'nav.liked': 'Favoritos',
    'nav.collections': 'Colecciones',
    'nav.owner': 'Owner',
    'nav.support': 'Soporte y licencia',
    'footer.credit_prefix': 'Creacion y mantenimiento continuo del sitio por',
    'theme.night': 'Noche',
    'theme.day': 'Dia',
    'settings.open': 'Ajustes',
    'settings.title': 'Ajustes',
    'settings.close': 'Cerrar ajustes',
    'settings.language': 'Idioma',
    'settings.appearance': 'Apariencia',
    'settings.transparency': 'Transparencia',
    'settings.translucency': 'Translucidez',
    'settings.solid': 'Opaco',
    'settings.clear': 'Claro',
    'settings.sharp': 'Nitido',
    'settings.frosted': 'Difuso',
    'account.open': 'Cuenta',
    'account.title': 'Cuenta',
    'account.close': 'Cerrar cuenta',
    'account.visitor_status': 'Navegar como visitante',
    'account.choose': 'Continua sin iniciar sesion, o verifica tu email con Google.',
    'account.continue_visitor': 'Continuar como visitante',
    'account.continue_browsing': 'Continuar',
    'account.sign_up_google': 'Registrarse con Google',
    'account.sign_in_google': 'Iniciar sesion con Google',
    'account.sign_out': 'Cerrar sesion',
    'account.signed_in': 'Sesion iniciada',
    'account.verified_email': 'Email verificado por Google.',
    'account.loading': 'Comprobando cuenta...',
    'account.redirecting': 'Abriendo inicio de sesion de Google...',
    'account.signing_out': 'Cerrando sesion...',
    'account.login_unavailable': 'El inicio de sesion con Google no esta disponible desde esta pagina.',
    'account.session_failed': 'No se pudo comprobar la sesion de Google.',
    'account.memory_title': 'Perfil guardado',
    'account.memory_body': 'Los pedidos y enlaces de descarga vienen del email verificado. Guardar favoritos/cesta copia las elecciones de este navegador a la cuenta.',
    'account.memory_counts': '{likes} favoritas · {basket} cesta · {orders} pedidos',
    'account.sync_now': 'Guardar favoritos/cesta',
    'account.sync_help': 'Guarda favoritos y cesta de este navegador. Los pedidos y enlaces de descarga se conectan automaticamente al email de pago.',
    'account.open_liked': 'Ver favoritas',
    'account.open_basket': 'Ver cesta',
    'account.orders_title': 'Pedidos y descargas',
    'account.no_orders': 'Aun no hay pedidos guardados en esta cuenta.',
    'account.view_downloads': 'Abrir pedido',
    'account.resend_downloads': 'Reenviar instrucciones',
    'account.resend_unavailable': 'Reenviar cuando los archivos esten listos',
    'account.order_resending': 'Enviando instrucciones...',
    'account.order_resent': 'Instrucciones enviadas a {email}.',
    'account.order_resend_failed': 'No se pudo reenviar: {message}',
    'account.order_ready': 'Listo',
    'account.order_pending': 'Pendiente',
    'account.profile_loaded': 'Pedidos actualizados.',
    'account.profile_saved': 'Favoritos y cesta guardados.',
    'account.profile_syncing': 'Actualizando cuenta...',
    'account.profile_failed': 'No se pudo actualizar la cuenta.',
    'home.lead': 'Un archivo seleccionado de fotos tomadas por Elie, con galerias por pais y muestras representativas nuevas mientras gira el carril de colecciones.',
    'home.view_collections': 'Ver colecciones',
    'home.collections': 'Colecciones',
    'home.discover': 'Buscar fotos',
    'home.collection_filter': 'Coleccion',
    'home.results': 'Resultados de busqueda',
    'home.loading_catalog': 'Cargando catalogo...',
    'home.catalog_ready': '{count} fotos listas.',
    'home.showing_results': 'Mostrando {count} de {total} fotos.',
    'home.showing_matches': 'Mostrando {count} de {total} resultados.',
    'home.no_matches': 'Ninguna foto coincide con los filtros.',
    'home.show_more': 'Ver mas',
    'home.show_all': 'Ver todo',
    'home.see_more_count': 'Mostrar {count} mas',
    'home.see_all_count': 'Mostrar todo {count}',
    'home.title_required': 'El titulo no puede estar vacio.',
    'home.saving_metadata': 'Guardando metadatos...',
    'home.metadata_saved': 'Metadatos de {title} guardados.',
    'home.metadata_failed': 'No se pudieron guardar los metadatos.',
    'home.moved_blocked': '{title} movida a la papelera.',
    'home.block_failed': 'No se pudo mover la foto a la papelera.',
    'home.discarded': '{title} descartada.',
    'home.discard_failed': 'No se pudo descartar la foto.',
    'home.undo_failed': 'No se pudo deshacer el ultimo movimiento a la papelera.',
    'home.nothing_to_undo': 'No hay movimiento local a la papelera para deshacer.',
    'home.undo_done': 'Ultimo movimiento a la papelera deshecho.',
    'home.owner_action_failed': 'Fallo la accion Owner.',
    'collection.france': 'Francia',
    'collection.usa': 'EE. UU.',
    'collection.spain': 'España',
    'collection.apple-2025-alhaurin-de-la-torre-sunset': '2025 Alhaurin de la Torre, atardecer',
    'collection.apple-2025-cadiz': '2025 Cadiz',
    'collection.apple-2025-cordoba-la-mezquita': '2025 Cordoba, la Mezquita',
    'collection.apple-2025-florence': '2025 Florencia',
    'collection.apple-2025-fuengirola-moon-over-the-mediterranean': '2025 Fuengirola, luna sobre el Mediterraneo',
    'collection.apple-2025-madrid-real-palacio': '2025 Madrid, Palacio Real',
    'collection.apple-2025-pisa': '2025 Pisa',
    'collection.apple-2025-ronda': '2025 Ronda',
    'collection.apple-2025-san-gimignano': '2025 San Gimignano',
    'collection.apple-2025-seville': '2025 Sevilla',
    'collection.apple-2025-valencia-aquarium': '2025 Valencia, Acuario',
    'collection.apple-2025-valencia-catedral': '2025 Valencia, Catedral',
    'collection.apple-2025-views-from-home-malaga-airport': '2025 Vistas desde casa, aeropuerto de Malaga',
    'collection.apple_2025_cordoba_la_mezquita': '2025 Cordoba, la Mezquita',
    'collection.apple-2026-malaga-museo-ruso': '2026 Malaga Museo Ruso',
    'collection.apple-2026-nerja-caves': '2026 Cuevas de Nerja',
    'collection.apple_2026_malaga_museo_ruso': '2026 Malaga Museo Ruso',
    'collection.apple_2026_nerja_caves': '2026 Cuevas de Nerja',
    'collection.mexico': 'México',
    'collection.ai': 'Imagenes IA',
    'collection.italy': 'Italia',
    'collection.portugal': 'Portugal',
    'collection.slovakia': 'Eslovaquia',
    'collection.panoramas': 'Panoramas',
    'collection.video-trial': 'Prueba de video Cordoba',
    'common.back_to_collections': 'Volver a colecciones',
    'common.back_to_gallery': 'Volver a la galeria',
    'common.back_to_search': 'Volver a la busqueda',
    'common.previous': 'Anterior',
    'common.next': 'Siguiente',
    'common.refresh': 'Actualizar',
    'common.photo': 'Foto',
    'common.photo_detail': 'Detalle de foto',
    'preview.full_height': 'Altura maxima',
    'preview.fit_width': 'Ajustar ancho',
    'gallery.grid': 'Cuadricula',
    'gallery.fit': 'Ajustar',
    'gallery.fill': 'Rellenar',
    'gallery.make_selection': 'Buscar',
    'gallery.orientation': 'Orientacion',
    'gallery.origin': 'Origen',
    'gallery.search': 'Buscar',
    'gallery.search_placeholder': 'Titulo o palabra clave',
    'gallery.date_from': 'Desde',
    'gallery.date_to': 'Hasta',
    'gallery.any_date': 'Cualquier fecha',
    'gallery.media': 'Medios',
    'gallery.all_media': 'Todos',
    'gallery.photos': 'Fotos',
    'gallery.videos': 'Videos',
    'gallery.color_mood': 'Color',
    'gallery.subject': 'Tema',
    'gallery.sort': 'Orden',
    'gallery.all': 'Todo',
    'gallery.pano': 'Pano',
    'gallery.landscape': 'Horizontal',
    'gallery.portrait': 'Vertical',
    'gallery.square': 'Cuadrada',
    'gallery.min_size': 'Tamano min',
    'gallery.min_duration': 'Duracion min',
    'gallery.any_size': 'Cualquier tamano',
    'gallery.any_duration': 'Cualquier duracion',
    'gallery.size_1mp': '1 MP+',
    'gallery.size_3mp': '3 MP+',
    'gallery.size_6mp': '6 MP+',
    'gallery.size_10mp': '10 MP+',
    'gallery.size_20mp': '20 MP+',
    'gallery.duration_5s': '5 s+',
    'gallery.duration_10s': '10 s+',
    'gallery.duration_20s': '20 s+',
    'gallery.duration_30s': '30 s+',
    'gallery.duration_60s': '60 s+',
    'origin.camera': 'Foto de camara',
    'origin.ai': 'Imagen IA',
    'gallery.warm': 'Calido',
    'gallery.cool': 'Frio',
    'gallery.neutral': 'Neutro',
    'gallery.vivid': 'Vivo',
    'gallery.architecture': 'Arquitectura',
    'gallery.water': 'Agua/costa',
    'gallery.art': 'Arte/museo',
    'gallery.people': 'Personas',
    'gallery.nature': 'Naturaleza',
    'gallery.city': 'Ciudad/viaje',
    'gallery.newest': 'Mas reciente',
    'gallery.oldest': 'Mas antiguo',
    'gallery.collection_order': 'Orden de coleccion',
    'gallery.title': 'Titulo',
    'gallery.largest_mp': 'Mas MP',
    'gallery.smallest_mp': 'Menos MP',
    'gallery.longest_duration': 'Mas largo',
    'gallery.shortest_duration': 'Mas corto',
    'gallery.highest_price': 'Precio alto',
    'gallery.lowest_price': 'Precio bajo',
    'gallery.mood_photos_only': 'El color esta disponible solo para fotos',
    'gallery.clear': 'Limpiar',
    'gallery.no_filter_matches': 'Ninguna foto coincide con los filtros',
    'gallery.no_visible': 'No hay fotos visibles localmente en esta coleccion',
    'gallery.clear_filters': 'Limpiar filtros',
    'gallery.adjust_filters': 'Ajusta o limpia los filtros para volver a mostrar esta coleccion.',
    'gallery.showing_count': 'Mostrando {count} fotos.',
    'gallery.showing_filtered': 'Mostrando {count} de {total} fotos.',
    'gallery.showing_count_items': 'Mostrando {count} {items}.',
    'gallery.showing_filtered_items': 'Mostrando {count} de {total} {items}.',
    'gallery.media_photos': 'fotos',
    'gallery.media_videos': 'videos',
    'gallery.media_items': 'elementos multimedia',
    'gallery.reserve_available': '{status} El relleno de reserva esta disponible.',
    'detail.pick_resolution': 'Elige una resolucion',
    'detail.total_selected': 'Total seleccionado:',
    'detail.archive_reset_title': 'Reinicio del archivo en curso',
    'detail.no_published_meta': '{collection} / Aun no hay fotos publicadas',
    'detail.no_published': 'Aun no hay fotos publicadas',
    'detail.rebuilding': 'Esta galeria se esta reconstruyendo desde el archivo Saturn.',
    'detail.mp_verified': '{mp} MP verificados',
    'detail.info': 'Info',
    'detail.shortcuts': 'Atajos:',
    'detail.like': 'favorito',
    'detail.prev_next': 'anterior/siguiente',
    'detail.full_screen': 'pantalla completa',
    'detail.hide': 'ocultar',
    'detail.undo': 'deshacer',
    'detail.open_full_screen': 'Cerrar vista a pantalla completa de {title}',
    'detail.added_liked': '{title} agregada a favoritos.',
    'detail.removed_liked': '{title} quitada de favoritos.',
    'detail.removed_basket': '{title} retirada de la cesta.',
    'detail.no_selection': 'No hay selecciones de cesta para esta foto.',
    'detail.saved': 'Selecciones de pedido guardadas para {title}.',
    'detail.count': 'Cantidad',
    'detail.frame': 'Marco',
    'basket.title': 'Cesta',
    'basket.empty': 'Tu cesta esta vacia.',
    'basket.order_intent': 'Intencion de pedido',
    'basket.confirm_assets': 'Confirmar archivos digitales',
    'basket.license_note': 'Revisa tus archivos digitales antes del checkout. El uso personal para impresion y web esta incluido; los usos comerciales, la reventa y el entrenamiento de IA requieren aprobacion escrita.',
    'basket.buyer_email': 'Email del comprador',
    'basket.pay_guest': 'Comprar ahora',
    'basket.simulate_payment': 'Simular pago Stripe',
    'basket.checkout_note': 'Checkout usa USD. Stripe tiene un cargo minimo de $0.50; los pedidos menores anaden la diferencia.',
    'trust.eyebrow': 'Notas para comprador',
    'trust.checkout_title': 'Antes de pagar',
    'trust.order_title': 'Guardar para recuperar',
    'trust.stripe_payment': 'Stripe gestiona el pago con tarjeta y el recibo; PhotosByElie gestiona la entrega privada de archivos.',
    'trust.recovery': 'El ID del pedido y el email de checkout recuperan descargas en la pagina del pedido.',
    'trust.license_short': 'El uso personal para impresion y web esta incluido; uso comercial, reventa y entrenamiento de IA necesitan aprobacion escrita.',
    'trust.support_short': 'Si la entrega parece incorrecta, contacta soporte con el ID del pedido antes de volver a comprar.',
    'trust.receipt_record': 'El recibo de Stripe es tu registro de pago. Esta pagina de pedido es el registro de entrega.',
    'trust.download_window': 'Las filas de descarga muestran la ventana de disponibilidad de cada archivo cuando el Worker la proporciona.',
    'trust.support_order': 'Para enlaces vencidos, cargos duplicados o archivos faltantes, contacta soporte con el ID del pedido y el email de checkout.',
    'browser_warning.title': 'Abrir en tu navegador',
    'browser_warning.checkout': 'Los navegadores integrados de Pinterest y redes sociales pueden bloquear pagos y descargas. Abre esta pagina en Safari o Chrome antes del checkout.',
    'browser_warning.download': 'Los navegadores integrados de Pinterest y redes sociales pueden bloquear las descargas. Abre este pedido en Safari o Chrome y descarga tus archivos.',
    'browser_warning.open': 'Abrir en navegador',
    'browser_warning.open_order': 'Abrir pedido',
    'browser_warning.copy': 'Copiar enlace',
    'browser_warning.copied': 'Enlace copiado. Abrelo en Safari o Chrome.',
    'browser_warning.copy_failed': 'Copia la URL de la pagina y abrela en Safari o Chrome.',
    'basket.assets_total': '{count} {assetWord}, {total}',
    'basket.asset_singular': 'archivo',
    'basket.asset_plural': 'archivos',
    'basket.order_id': 'Pedido',
    'basket.photos': 'Fotos',
    'basket.assets': 'Archivos',
    'basket.original_subtotal': 'Subtotal original',
    'basket.draft_total': 'Total borrador',
    'basket.discount_code': 'Codigo descuento',
    'basket.discount': 'Descuento',
    'basket.discounted_subtotal': 'Subtotal con descuento',
    'basket.minimum_charge': 'Minimo Stripe',
    'basket.minimum_adjustment': 'Ajuste minimo',
    'basket.payable_total': 'Total a pagar',
    'basket.collections': 'Colecciones',
    'basket.checkout_needs_asset': 'Checkout necesita al menos un archivo digital en la cesta.',
    'basket.enter_email': 'Introduce un email de comprador antes de iniciar checkout.',
    'basket.checking_delivery': 'Comprobando archivos de entrega antes de abrir Stripe...',
    'basket.unavailable_removed_review': 'Se retiraron opciones de entrega no disponibles. Revisa la cesta actualizada y elige Comprar ahora de nuevo.',
    'basket.creating_checkout': 'Preparando checkout seguro de Stripe...',
    'basket.opening_stripe': 'Abriendo Stripe Checkout...',
    'basket.mock_ready': 'Sesion Checkout mock lista. Simula el pago Stripe para generar el ZIP.',
    'basket.simulating_payment': 'Simulando pago Stripe y generando el ZIP de entrega...',
    'basket.mock_complete': 'Pago mock completado. ZIP de entrega generado.',
    'basket.item_removed': 'Elemento retirado de la cesta.',
    'basket.item_singular': 'elemento',
    'basket.item_plural': 'elementos',
    'basket.choices_updated': 'Opciones de archivos actualizadas para {title}.',
    'basket.no_assets_selected': '{title} no tiene archivos seleccionados. Usa Retirar para borrar la foto.',
    'basket.remove': 'Retirar',
    'liked.title': 'Favoritos',
    'liked.empty': 'Aun no hay fotos favoritas.',
    'liked.select_all_full': 'Seleccionar todo Full',
    'liked.select_all_6': 'Seleccionar todo 6 MP',
    'liked.select_all_3': 'Seleccionar todo 3 MP',
    'liked.select_all_1': 'Seleccionar todo 1 MP',
    'liked.select_all_option': 'Seleccionar todo {option}',
    'liked.deselect_all_option': 'Deseleccionar todo {option}',
    'liked.selected_some': '{option} seleccionado para {count} foto(s) favorita(s); {unavailable} no disponible(s).',
    'liked.selected_all': '{option} seleccionado para {count} foto(s) favorita(s).',
    'liked.deselected_some': '{option} deseleccionado para {count} foto(s) favorita(s); {unavailable} no disponible(s).',
    'liked.deselected_all': '{option} deseleccionado para {count} foto(s) favorita(s).',
    'liked.unlike': 'Quitar',
    'liked.removed': '{title} quitada de favoritos.',
    'liked.added_to_basket': 'Opciones de archivos agregadas a la cesta para {title}.',
    'liked.no_assets_selected': '{title} no tiene archivos seleccionados.',
    'order.title': 'Pedido',
    'order.checkout': 'Checkout',
    'order.loading': 'Cargando pedido',
    'order.checking_phase': 'Comprobando fase del pedido',
    'order.checking_worker': 'Comprobando estado con el Worker de checkout.',
    'order.payment': 'Pago',
    'order.stripe': 'Stripe',
    'order.build_zip': 'Preparar archivos',
    'order.private_r2': 'R2 privado',
    'order.download': 'Descarga',
    'order.ready_label': 'Listo',
    'order.waiting_payment': 'Esperando pago',
    'order.building_zip': 'Preparando archivos',
    'order.delivery_blocked': 'Entrega bloqueada',
    'order.ready_download': 'Listo para descargar',
    'order.phase_3': 'Fase 3 de 3',
    'order.ready_message': 'El pago esta completo y tus archivos privados estan listos.',
    'order.email_notice_title': 'Email de entrega enviado',
    'order.email_notice_body': 'Tambien enviamos un enlace de descarga por cada articulo comprado. Si no aparece en unos minutos, revisa Spam o Correo no deseado para Photos By Elie downloads are ready.',
    'order.email_notice_fallback_title': 'Conserva esta pagina del pedido',
    'order.email_notice_fallback_body': 'Tus descargas estan listas aqui. Si el email de entrega tarda en llegar, manten esta pagina abierta y revisa tambien Spam o Correo no deseado.',
    'order.resend_email': 'Reenviar email',
    'order.resending_email': 'Enviando email de entrega...',
    'order.email_resent': 'Email de entrega reenviado. Revisa tu bandeja, Spam o Correo no deseado.',
    'order.email_resend_failed': 'No se pudo reenviar el email: {message}',
    'order.account_history_title': 'Todas las fotos compradas',
    'order.account_history_body': 'Pedidos vinculados a este email conectado. Abre un pedido para descargar; reenviar manda instrucciones al email original de pago.',
    'order.account_history_empty': 'No se encontro historial de pedidos conectado.',
    'order.account_history_current': 'Pedido actual',
    'order.resend_original_email': 'Reenviar instrucciones',
    'order.account_history_resent': 'Instrucciones enviadas a {email}.',
    'order.account_history_resend_failed': 'No se pudo reenviar: {message}',
    'order.blocked_phase_2': 'Bloqueado despues de fase 2',
    'order.delivery_attention': 'Entrega necesita atencion',
    'order.delivery_failed': 'El pago esta completo, pero el Worker no pudo preparar uno o mas archivos.',
    'order.phase_2': 'Fase 2 de 3',
    'order.building_message': 'El pago esta completo. Estamos preparando tus archivos privados; puede tardar hasta 10 minutos para pedidos de resolucion completa o con varias fotos.',
    'order.delivery_files': 'Archivos de entrega',
    'order.files_preparing': 'Preparando cada archivo',
    'order.files_ready': 'Descarga cada archivo por separado',
    'order.files_ready_count': '{ready} de {total} archivos listos',
    'order.download_available_until': 'Disponible hasta {date}',
    'order.download_all_files': 'Descargar todos',
    'order.open_browser_to_download': 'Abrir navegador',
    'order.download_file': 'Descargar',
    'order.file_ready': 'Listo',
    'order.file_preparing': 'Preparando',
    'order.file_needs_attention': 'Necesita atencion',
    'order.file_downloading': 'Descargando...',
    'order.file_downloaded': 'Descargado',
    'order.file_failed': 'Error:',
    'order.payment_not_confirmed': 'Pago no confirmado',
    'order.payment_message': 'Stripe esta confirmando el pago. Normalmente tarda unos segundos; la pagina se actualizara automaticamente.',
    'order.details_needed': 'Faltan datos del pedido',
    'order.details_message': 'Introduce el ID del pedido del recibo y el email de checkout para recuperar las descargas.',
    'order.lookup_order_id': 'ID del pedido',
    'order.lookup_email': 'Email de checkout',
    'order.lookup_button': 'Buscar pedido',
    'order.lookup_required': 'Introduce el numero de pedido y el email de checkout.',
    'order.refreshing': 'Actualizando pedido...',
    'order.refreshed': 'Pedido actualizado.',
    'order.cached': 'Mostrando pedido local en cache. La descarga usa el ZIP generado en disco.',
    'order.unavailable': 'Pedido no disponible',
    'order.could_not_load': 'No se pudo cargar el pedido desde el Worker de checkout.',
    'order.download_requested_local': 'Descarga solicitada. Si el navegador integrado no muestra una descarga, usa la ruta ZIP local debajo.',
    'order.download_requested_worker': 'Descarga solicitada desde el Worker de checkout.',
    'order.local_path_copied': 'Ruta ZIP local copiada.',
    'order.copy_failed_select': 'Ruta ZIP seleccionada. Pulsa Command-C para copiarla.',
    'order.zip_location': 'Ubicacion ZIP',
    'order.status': 'Estado',
    'order.email': 'Email',
    'order.total': 'Total',
    'order.paid': 'Pagado',
    'order.mode': 'Modo',
    'order.delivery_note': 'Nota de entrega',
    'order.local_zip': 'ZIP local',
    'order.delivery_zip': 'ZIP de entrega',
    'support.eyebrow': 'Soporte comprador',
    'support.title': 'Soporte y licencia',
    'support.lead': 'Stripe es el recibo de pago. PhotosByElie es el registro de entrega y recuperacion de descargas privadas.',
    'support.recover_order': 'Recuperar pedido',
    'support.email_support': 'Email soporte',
    'support.payment_eyebrow': 'Pago',
    'support.payment_title': 'Recibos y extractos de tarjeta',
    'support.payment_1': 'Stripe procesa pagos con tarjeta y envia el recibo cuando los recibos estan activados.',
    'support.payment_2': 'Los extractos de tarjeta deberian mostrar PHOTOSELIE* DOWNLOAD para nuevos pagos de checkout.',
    'support.payment_3': 'Guarda el recibo de Stripe y tu ID de pedido PhotosByElie; el ID del pedido recupera las descargas.',
    'support.delivery_eyebrow': 'Entrega',
    'support.delivery_title': 'Recuperacion de descargas',
    'support.delivery_1': 'Despues del pago, la pagina del pedido prepara enlaces privados para cada archivo comprado.',
    'support.delivery_2': 'Usa el ID del pedido y el email de checkout en la pagina del pedido si necesitas descargar de nuevo.',
    'support.delivery_3': 'Los enlaces actuales pueden vencer o llegar al limite; soporte puede revisar un pedido pagado y renovar la entrega cuando corresponda.',
    'support.license_eyebrow': 'Licencia',
    'support.license_title': 'Uso incluido',
    'support.license_1': 'Las compras digitales incluyen uso personal para impresion y web por el comprador.',
    'support.license_2': 'Uso comercial, reventa, redistribucion, licencias stock, productos y entrenamiento de IA necesitan aprobacion escrita primero.',
    'support.license_3': 'Pregunta antes de usar un archivo para un cliente, producto, campana pagada o proyecto comercial publico.',
    'support.refunds_eyebrow': 'Ayuda',
    'support.refunds_title': 'Reembolsos y problemas de entrega',
    'support.refunds_1': 'Si un archivo no puede entregarse, aparece un cargo duplicado, o compraste una resolucion equivocada por error, envia un email con el ID del pedido.',
    'support.refunds_2': 'Los reembolsos se revisan caso por caso. Errores de entrega y cargos duplicados se tratan primero como problemas de soporte.',
    'support.refunds_3': 'Usa el boton Email soporte desde la pagina del pedido para ayuda de entrega.',
    'support.credits_title': 'Creditos del sitio',
    'support.credits_copy_prefix': 'Photos By Elie esta fotografiado y curado por Elie Cohen. Diseno, creacion y mantenimiento continuo del sitio por',
    'product.digital': 'Archivo digital',
    'product.print': 'Copia',
    'product.frame': 'Marco',
    'product.product': 'Producto',
    'product.full': 'Resolucion completa',
    'product.full_detail': 'Archivo fuente original a resolucion nativa',
    'product.jpg_6': 'JPG 6 MP',
    'product.jpg_6_detail': 'Exportacion de lado largo para copia y web premium',
    'product.jpg_3': 'JPG 3 MP',
    'product.jpg_3_detail': 'Uso en listado, portfolio y web editorial',
    'product.jpg_1': 'JPG 1 MP',
    'product.jpg_1_detail': 'Vista web pequena y borrador social',
    'product.print_detail': 'Copia fotografica clasica',
    'product.no_frame': 'Sin marco',
    'product.white_frame': 'Marco blanco sencillo',
    'product.black_frame': 'Marco negro sencillo',
    'product.original': 'Original: {source}',
    'product.decrease_count': 'Reducir cantidad de {label}',
    'product.increase_count': 'Aumentar cantidad de {label}',
    'nav.real_estate': 'Inmobiliaria',
    're.login.eyebrow': 'Acceso privado de cliente',
    're.login.title': 'Acceso de cliente',
    're.login.username': 'Usuario',
    're.login.password': 'Contrasena',
    're.login.legacy_password': 'Contrasena anterior',
    're.login.show_password': 'Mostrar contrasena',
    're.login.hide_password': 'Ocultar contrasena',
    're.login.submit': 'Entrar',
    're.selection.label': 'Seleccion',
    're.selection.name': 'Nombre de seleccion',
    're.hero.customer_review': 'Revision {name}',
    're.hero.client_review': 'Revision de cliente',
    're.hero.title': 'Seleccion inmobiliaria',
    're.hero.description': 'Espacio privado de revision de medios para entregar PDF de proyecto y presentaciones.',
    're.stats.gallery_totals': 'Totales de galeria',
    're.stats.stills': 'Fotos',
    're.stats.videos': 'Videos',
    're.stats.albums': 'Albumes',
    're.stats.selections': 'Selecciones',
    're.cta.create_selection': '+ Crear seleccion',
    're.cta.first_selection': 'Crea tu primera seleccion',
    're.help.button': 'Ayuda',
    're.shelf.eyebrow': 'Producido hasta ahora',
    're.shelf.title': 'Tus productos guardados',
    're.shelf.note': 'Abre o descarga los archivos guardados en el telefono o en el ordenador. Puedes guardarlos o compartirlos como prefieras.',
    're.wizard.steps_label': 'Pasos de revision inmobiliaria',
    're.wizard.back_shelf': 'Volver al estante',
    're.workbench.label': 'Espacio de revision inmobiliaria',
    're.controls.label': 'Controles de revision',
    're.step.shoots': 'Sesiones',
    're.step.photos': 'Fotos',
    're.step.titles': 'Titulos',
    're.step.order': 'Orden',
    're.step.output': 'Salida',
    're.panel.shoots': 'Sesiones',
    're.panel.filters': 'Filtros',
    're.filter.search': 'Buscar',
    're.filter.search_placeholder': 'Titulo, archivo o album',
    're.filter.sort': 'Orden',
    're.filter.card_size': 'Tamano de tarjeta',
    're.filter.selected_only': 'Solo seleccionados',
    're.sort.album': 'Orden de album',
    're.sort.selected': 'Seleccionados primero',
    're.sort.file': 'Nombre de archivo',
    're.media.all': 'Fotos + videos',
    're.density.compact': 'Compacto',
    're.density.balanced': 'Equilibrado',
    're.density.large': 'Grande',
    're.draft.title': 'Borrador de salida',
    're.draft.empty': 'Aun no hay medios seleccionados.',
    're.gallery.title': 'Revision de medios',
    're.action.select_visible': 'Seleccionar visibles',
    're.action.save_selection': 'Guardar seleccion',
    're.action.files_selected': 'archivos seleccionados',
    're.action.clear_selected': 'Limpiar seleccion',
    're.action.sign_out': 'Salir',
    're.action.cancel': 'Cancelar',
    're.action.pick_photos': 'Elegir fotos',
    're.action.choose_output': 'Elegir salida',
    're.output.download_pdf': 'Descargar PDF',
    're.output.download_video': 'Descargar video',
    're.output.share_originals': 'Compartir ZIP originales',
    're.output.eyebrow': 'Paso 5',
    're.output.title': 'Previsualizar o descargar',
    're.output.note': 'Cada seleccion incluye formatos PDF y video. Previsualiza cualquiera de los dos o descarga archivos PDF y video reales en el telefono o en el ordenador.',
    're.output.paper_size': 'Tamano de papel PDF',
    're.output.photo_seconds': 'Segundos por foto en video',
    're.output.video_format': 'Formato de video',
    're.output.video_landscape': 'Horizontal',
    're.output.video_portrait': 'Vertical',
    're.output.music_country': 'Pais de la musica',
    're.output.music_auto': 'Automatico por proyecto',
    're.output.watermark_text': 'Texto de marca de agua',
    're.output.watermark_enabled': 'Usar marca de agua en PDF y video',
    're.output.preview_pdf': 'Previsualizar PDF',
    're.output.preview_video': 'Previsualizar video',
    're.output.download_everything': 'Descargar todo',
    're.output.download_everything_busy': 'Preparando todo...',
    're.status.ready': 'Listo',
    're.status.loading': 'Cargando galeria inmobiliaria...',
    're.status.choose_shoots': 'Elige sesiones para empezar.',
    're.status.choose_shoots_step': 'Elige las sesiones de las que quieres seleccionar.',
    're.status.click_media': 'Haz clic en medios de {project} para seleccionarlos. Mayus-clic selecciona un rango.',
    're.status.selected_titles': 'Solo se muestran los {count} medios seleccionados. Cambia titulos solo cuando haga falta.',
    're.status.select_before_titles': 'Selecciona al menos una foto o video antes de editar titulos.',
    're.status.drag_selected': 'Arrastra los {count} medios seleccionados al orden que quieras.',
    're.status.select_before_order': 'Selecciona al menos una foto o video antes de ordenar.',
    're.status.ready_output': 'Listo para salida: {summary}. Prepara el PDF y el video y elige Siguiente para revisar los productos terminados.',
    're.status.select_before_output': 'Selecciona al menos una foto o video antes de crear salidas.',
    're.progress.working': 'Trabajando...',
    're.progress.done': 'Terminado',
    're.progress.needs_attention': 'Necesita atencion',
    're.dialog.close_preview': 'Cerrar vista previa de medios',
    're.dialog.output_title': 'Titulo de salida',
    're.dialog.selected_for_output': 'Seleccionado para salida',
    're.help.eyebrow': 'Nueva seleccion',
    're.help.title': 'Como funcionan las salidas del proyecto',
    're.help.step1': 'Elige primero una o mas sesiones; el paso Fotos muestra solo esos medios.',
    're.help.step2': 'Haz clic en fotos o videos para seleccionar los que quieres usar.',
    're.help.step3': 'Ve a Titulos y cambia solo los pies que deban ser diferentes en el producto final.',
    're.help.step4': 'Ve a Orden y arrastra los medios seleccionados a la secuencia del PDF o video.',
    're.help.step5': 'Ve a Salida para previsualizar el PDF o el video, y luego descarga el archivo que necesites.',
    're.help.step6': 'Abre o descarga los archivos PDF y video generados en el telefono o en el ordenador; guardalos o compartelos como prefieras.',
    're.help.step7': 'Abre una seleccion guardada desde el estante cuando quieras continuar o revisar un trabajo anterior.',
    're.help.start': 'Empezar seleccion',
    're.help.close': 'Cerrar ayuda',
    're.originals.eyebrow': 'Originales privados',
    're.originals.title': 'Contrasena ZIP originales',
    're.originals.cancel_zip': 'Cancelar ZIP originales',
    're.originals.create_zip': 'Crear ZIP',
  },
};

const translate = (keyName, replacements = {}) => {
  const language = root.dataset.language || 'en';
  const text = translations[language]?.[keyName] ?? translations.en[keyName] ?? keyName;
  return Object.entries(replacements).reduce(
    (value, [name, replacement]) => value.replaceAll(`{${name}}`, String(replacement ?? '')),
    text
  );
};

const applyTranslations = () => {
  const setFromDataset = (selector, datasetKey, setter) => {
    document.querySelectorAll(selector).forEach((element) => {
      const keyName = element.dataset[datasetKey];
      if (!keyName) return;
      setter(element, translate(keyName));
    });
  };
  setFromDataset('[data-i18n]', 'i18n', (element, value) => { element.textContent = value; });
  setFromDataset('[data-i18n-placeholder]', 'i18nPlaceholder', (element, value) => element.setAttribute('placeholder', value));
  setFromDataset('[data-i18n-aria-label]', 'i18nAriaLabel', (element, value) => element.setAttribute('aria-label', value));
  setFromDataset('[data-i18n-title]', 'i18nTitle', (element, value) => element.setAttribute('title', value));
  syncSupportEmailDrafts();
};

window.photosByElieI18n = {
  t: translate,
  language: () => root.dataset.language || 'en',
  apply: applyTranslations,
};

const displaySettingDefaults = {
  transparency: 50,
  translucency: 50,
};
const glassAlphaDefaults = {
  dark: {
    topbar: 0.56,
    control: 0.62,
    panel: 0.5,
    card: 0.58,
    cardHover: 0.68,
    pill: 0.64,
    field: 0.76,
  },
  light: {
    topbar: 0.26,
    control: 0.26,
    panel: 0.26,
    card: 0.26,
    cardHover: 0.32,
    pill: 0.272,
    field: 0.72,
  },
};
const realEstateGlassAlphaDefaults = {
  topbar: 0.86,
  control: 0.62,
  panel: 0.97,
  card: 0.98,
  cardHover: 1,
  pill: 0.64,
  field: 0.76,
};
const glassBlurDefaults = (() => {
  const parsed = (value, fallback) => {
    const number = Number.parseFloat(String(value || ""));
    return Number.isFinite(number) ? number : fallback;
  };
  try {
    const computed = getComputedStyle(document.body || root);
    return {
      heavy: parsed(computed.getPropertyValue("--glass-heavy-blur"), 2.5),
      light: parsed(computed.getPropertyValue("--glass-light-blur"), 2),
    };
  } catch {
    return { heavy: 2.5, light: 2 };
  }
})();
const clampDisplayValue = (value) => Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
const normalizeDisplaySettings = (settings = {}) => ({
  transparency: clampDisplayValue(settings.transparency ?? displaySettingDefaults.transparency),
  translucency: clampDisplayValue(settings.translucency ?? displaySettingDefaults.translucency),
});
const readDisplaySettings = () => {
  try {
    return normalizeDisplaySettings(JSON.parse(localStorage.getItem(displaySettingsKey) || "{}"));
  } catch {
    return { ...displaySettingDefaults };
  }
};
const saveDisplaySettings = (settings) => {
  const normalized = normalizeDisplaySettings(settings);
  try {
    localStorage.setItem(displaySettingsKey, JSON.stringify(normalized));
  } catch {
    // Visual preferences are optional when storage is unavailable.
  }
  return normalized;
};
const alphaFromTransparency = (baseAlpha, transparency) => {
  const base = Math.max(0.05, Math.min(1, Number(baseAlpha) || 0.5));
  if (transparency <= 50) {
    return base + ((1 - base) * ((50 - transparency) / 50) * 0.82);
  }
  return Math.max(0.045, base * (1 - (((transparency - 50) / 50) * 0.78)));
};
const blurFromTranslucency = (baseBlur, translucency) => {
  const base = Math.max(0, Number(baseBlur) || 0);
  if (base <= 0) return translucency <= 50 ? 0 : ((translucency - 50) / 50) * 6;
  const scale = translucency <= 50
    ? 0.15 + ((translucency / 50) * 0.85)
    : 1 + (((translucency - 50) / 50) * 1.8);
  return base * scale;
};
const formatCssNumber = (value) => {
  const fixed = Number(value).toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
  return fixed.startsWith("0.") ? fixed.slice(1) : fixed;
};
const glassRgb = () => {
  const computed = getComputedStyle(root);
  return {
    surface: (computed.getPropertyValue("--glass-surface-rgb") || "18 18 18").trim(),
    control: (computed.getPropertyValue("--glass-control-rgb") || "24 24 24").trim(),
  };
};
const setGlassVariable = (name, value) => {
  root.style.setProperty(name, value);
  document.body?.style?.setProperty(name, value);
};
const applyDisplaySettings = (settings = readDisplaySettings()) => {
  const normalized = normalizeDisplaySettings(settings);
  const theme = root.dataset.theme === "dark" ? "dark" : "light";
  const alphaBase = document.body?.matches?.("[data-real-estate]")
    ? realEstateGlassAlphaDefaults
    : (glassAlphaDefaults[theme] || glassAlphaDefaults.light);
  const rgb = glassRgb();
  const alpha = Object.fromEntries(Object.entries(alphaBase)
    .map(([name, value]) => [name, formatCssNumber(alphaFromTransparency(value, normalized.transparency))]));
  const panelBg = `rgb(${rgb.surface} / ${alpha.panel})`;
  const cardBg = `rgb(${rgb.surface} / ${alpha.card})`;
  const cardHoverBg = `rgb(${rgb.surface} / ${alpha.cardHover})`;
  const topbarBg = `rgb(${rgb.surface} / ${alpha.topbar})`;
  const controlBg = `rgb(${rgb.control} / ${alpha.control})`;
  const pillBg = `rgb(${rgb.control} / ${alpha.pill})`;
  const fieldBg = `rgb(${rgb.control} / ${alpha.field})`;
  setGlassVariable("--glass-topbar-alpha", alpha.topbar);
  setGlassVariable("--glass-control-alpha", alpha.control);
  setGlassVariable("--glass-panel-alpha", alpha.panel);
  setGlassVariable("--glass-card-alpha", alpha.card);
  setGlassVariable("--glass-card-hover-alpha", alpha.cardHover);
  setGlassVariable("--glass-pill-alpha", alpha.pill);
  setGlassVariable("--glass-field-alpha", alpha.field);
  setGlassVariable("--glass-panel-bg", panelBg);
  setGlassVariable("--glass-card-bg", cardBg);
  setGlassVariable("--glass-card-hover-bg", cardHoverBg);
  setGlassVariable("--glass-topbar-bg", topbarBg);
  setGlassVariable("--glass-control-bg", controlBg);
  setGlassVariable("--glass-pill-bg", pillBg);
  setGlassVariable("--glass-field-bg", fieldBg);
  setGlassVariable("--glass-re-panel-bg", panelBg);
  setGlassVariable("--glass-re-card-bg", cardBg);
  setGlassVariable("--glass-re-hero-bg", `linear-gradient(130deg,color-mix(in srgb,var(--re-accent, var(--text)) 9%,transparent),transparent 46%),${panelBg}`);
  setGlassVariable("--glass-heavy-blur", `${formatCssNumber(blurFromTranslucency(glassBlurDefaults.heavy, normalized.translucency))}px`);
  setGlassVariable("--glass-light-blur", `${formatCssNumber(blurFromTranslucency(glassBlurDefaults.light, normalized.translucency))}px`);
  return normalized;
};
const updateDisplaySettingOutputs = (settings) => {
  document.querySelectorAll("[data-display-setting-output]").forEach((output) => {
    const name = output.dataset.displaySettingOutput;
    if (!name) return;
    output.textContent = `${normalizeDisplaySettings(settings)[name]}%`;
  });
};

applyDisplaySettings();

window.photosByElieDisplaySettings = {
  read: readDisplaySettings,
  save: (settings) => {
    const saved = saveDisplaySettings(settings);
    applyDisplaySettings(saved);
    updateDisplaySettingOutputs(saved);
    window.dispatchEvent(new CustomEvent("photosbyelie:displaysettingschange", { detail: saved }));
    return saved;
  },
  apply: applyDisplaySettings,
};

const supportEmailAddress = 'orders@photos-by-elie.com';
const readSupportJson = (keyName, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(keyName) || JSON.stringify(fallback));
  } catch {
    return fallback;
  }
};

const supportMoneyFromCents = (value, currency = 'usd') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: String(currency || 'usd').toUpperCase() }).format(Number(value || 0) / 100);

const supportBasketSummary = () => {
  const items = readSupportJson('photosbyelie-basket', []);
  if (!Array.isArray(items) || !items.length) return [];
  const lines = [`Selected files (${items.length} item${items.length === 1 ? '' : 's'})`];
  items.slice(0, 8).forEach((item, index) => {
    const options = Array.isArray(item.options) ? item.options : [];
    const optionText = options.map((option) => option.label || option.id).filter(Boolean).join(', ') || 'No selected products';
    if (index) lines.push('');
    lines.push(`${index + 1}. ${item.title || item.photoId || 'Untitled photo'}`);
    lines.push(`   Photo ID: ${item.photoId || 'no photo ID'}`);
    lines.push(`   Collection: ${item.collection || 'unknown'}`);
    lines.push(`   Purchased product${options.length === 1 ? '' : 's'}: ${optionText}`);
  });
  if (items.length > 8) lines.push('', `Plus ${items.length - 8} more item${items.length - 8 === 1 ? '' : 's'} in the local basket.`);
  return lines;
};

const supportOrderDraft = () => {
  const params = new URLSearchParams(window.location.search);
  const checkoutState = readSupportJson('photosbyelie-mock-checkout', {});
  const order = checkoutState?.lastResponse?.order || {};
  const orderId = params.get('id') || checkoutState.orderId || order.id || '';
  const email = params.get('email') || checkoutState.email || order.buyerEmail || '';
  const sessionId = params.get('session_id') || checkoutState.checkoutSessionId || checkoutState.lastResponse?.checkout?.sessionId || '';
  const status = order.status || '';
  const currency = order.currency || 'usd';
  const subtotalAmount = order.originalSubtotalAmount ?? order.subtotalAmount ?? params.get('subtotal_amount');
  const discountCode = order.discountCode || params.get('discount_code') || '';
  const discountAmount = order.discountAmount ?? params.get('discount_amount');
  const amountExpected = order.amountExpected ?? params.get('amount_expected');
  const amountPaid = order.amountPaid ?? params.get('amount_paid');
  const subtotal = subtotalAmount ? supportMoneyFromCents(subtotalAmount, currency) : '';
  const discount = discountCode || Number(discountAmount || 0) ? supportMoneyFromCents(discountAmount, currency) : '';
  const total = amountExpected ? supportMoneyFromCents(amountExpected, currency) : '';
  const paid = amountPaid ? supportMoneyFromCents(amountPaid, currency) : '';
  const hasOrderContext = Boolean(orderId || email || sessionId || status || subtotal || discountCode || discount || total || paid);
  const subject = orderId
    ? `Photos By Elie download support - ${orderId}`
    : 'Photos By Elie download support';
  const orderLines = [
    orderId ? `Order ID: ${orderId}` : '',
    email ? `Checkout email: ${email}` : '',
    sessionId ? `Stripe Checkout session: ${sessionId}` : '',
    status ? `Status shown on site: ${status}` : '',
    subtotal ? `Original subtotal: ${subtotal}` : '',
    discountCode ? `Discount code: ${discountCode}` : '',
    discount ? `Discount amount: -${discount}` : '',
    total ? `Expected total: ${total}` : '',
    paid ? `Paid total: ${paid}` : '',
  ].filter(Boolean);
  const basketLines = supportBasketSummary();
  const intro = hasOrderContext
    ? [
      'I just completed a Photos By Elie checkout and need help with the download delivery for this order.',
      '',
      'What I need',
      'Please check the order status and send or re-enable the download links for the purchased files.',
      '',
      'Order details',
      ...orderLines,
      '',
    ]
    : [
      'Please help me find or recover my Photos By Elie order/download delivery.',
      '',
      'I do not have the order details on this device. Please look for a recent Photos By Elie checkout associated with this sending email address, or let me know what you need from my Stripe receipt/card statement to identify the order.',
      '',
      `Support page: ${window.location.href}`,
      '',
    ];
  const lines = [
    'Hello Photos By Elie,',
    '',
    ...intro,
    ...(basketLines.length ? [...basketLines, ''] : []),
    'Reference',
    `Support page: ${window.location.href}`,
    '',
    hasOrderContext
      ? 'The details above came from the Photos By Elie support/order pages and should identify the purchase.'
      : 'I am contacting support from the Photos By Elie support page and would like download recovery instructions.',
    '',
    'Thank you.',
    '',
  ];
  return { subject, body: lines.join('\n'), hasOrderContext };
};

const syncSupportEmailDrafts = () => {
  document.querySelectorAll('[data-support-email]').forEach((link) => {
    const draft = supportOrderDraft();
    link.hidden = !draft.hasOrderContext;
    link.setAttribute('href', `mailto:${supportEmailAddress}?subject=${encodeURIComponent(draft.subject)}&body=${encodeURIComponent(draft.body)}`);
  });
};

const rawSourceTypes = new Set(['DNG', 'NEF', 'CR2', 'CR3', 'ARW', 'RAF', 'ORF', 'RW2', 'RAW', 'PEF', 'SRW', 'RWL']);
const localHostnames = new Set(['localhost', '127.0.0.1', '::1']);
const desktopInputQuery = window.matchMedia?.('(hover: hover) and (pointer: fine)');
let hasKeyboardInput = false;

const syncInputModeClass = () => {
  const isDesktopInput = Boolean(desktopInputQuery?.matches);
  root.classList.toggle('is-localhost', localHostnames.has(window.location.hostname));
  root.classList.toggle('is-tap-first', !isDesktopInput);
  root.classList.toggle('is-desktop-input', isDesktopInput);
  root.classList.toggle('has-keyboard-input', hasKeyboardInput);
};

window.photosByElieInputMode = {
  isLocalhost: () => localHostnames.has(window.location.hostname),
  isTapFirst: () => !desktopInputQuery?.matches,
  isDesktopInput: () => Boolean(desktopInputQuery?.matches),
  hasKeyboardInput: () => hasKeyboardInput,
  shouldShowKeyboardHints: () => Boolean(desktopInputQuery?.matches) || hasKeyboardInput,
  applyKeyboardHint: (element, enabled = true) => {
    if (!element) return;
    element.hidden = !enabled || !window.photosByElieInputMode.shouldShowKeyboardHints();
  }
};

const productSettingsKey = 'photosbyelie-product-settings';
const physicalProductsToggleKey = 'physicalGoodsEnabled';
const physicalProductsAvailable = true;
const productCatalogUrl = './assets/catalog/product-pricing.json';
const normalizeStorefrontPolicy = (policy = {}) => ({
  retiredCollectionKeys: [...new Set((policy.retiredCollectionKeys || ['ai']).map((value) => String(value).trim().toLowerCase()).filter(Boolean))],
  retiredSourceOrigins: [...new Set((policy.retiredSourceOrigins || ['ai']).map((value) => String(value).trim().toLowerCase()).filter(Boolean))],
});
const storefrontPhotoOrigin = (photo, collectionKey = '') => {
  const origin = String(photo?.sourceOrigin || photo?.origin || '').trim().toLowerCase();
  if (origin) return origin;
  if (String(photo?.pricingTier || '').trim().toLowerCase() === 'ai') return 'ai';
  return String(collectionKey || '').trim().toLowerCase() === 'ai' ? 'ai' : 'camera';
};
window.photosByElieStorefrontPolicy = normalizeStorefrontPolicy(window.photosByElieStorefrontPolicy);
window.photosByElieCollectionIsRetired = (collectionKey = '') => (
  window.photosByElieStorefrontPolicy.retiredCollectionKeys.includes(String(collectionKey).trim().toLowerCase())
);
window.photosByElieStorefrontAllowsPhoto = (photo, collectionKey = '') => (
  !window.photosByElieCollectionIsRetired(collectionKey)
  && !window.photosByElieStorefrontPolicy.retiredSourceOrigins.includes(storefrontPhotoOrigin(photo, collectionKey))
);
window.photosByElieApplyStorefrontPolicy = (collections = {}) => {
  Object.keys(collections || {}).forEach((collectionKey) => {
    if (window.photosByElieCollectionIsRetired(collectionKey)) {
      delete collections[collectionKey];
      return;
    }
    const collection = collections[collectionKey];
    if (!Array.isArray(collection?.photos)) return;
    collection.photos = collection.photos.filter((photo) => window.photosByElieStorefrontAllowsPhoto(photo, collectionKey));
  });
  return collections;
};
const applyProductCatalog = (catalog = {}) => {
  const products = Array.isArray(catalog.products) ? catalog.products : [];
  if (!products.length) return false;
  window.photosByElieProductCatalog = catalog;
  window.photosByElieStorefrontPolicy = normalizeStorefrontPolicy(catalog.storefrontPolicy || {});
  window.photosByElieResolutions = products.map((product) => ({
    ...product,
    prices: { ...(product.prices || {}) },
    price: Number(product.prices?.original ?? product.price ?? 0),
  }));
  window.photosByEliePriceTiers = Object.fromEntries(
    (Array.isArray(catalog.priceTiers) ? catalog.priceTiers : []).map((tier) => [tier.id, { label: tier.label }])
  );
  window.photosByElieFrameOptions = (catalog.frames || []).map((frame) => ({ ...frame, prices: { ...(frame.prices || {}) } }));
  window.photosByElieShippingHandlingPrices = { ...(catalog.shippingHandlingPrices || {}) };
  window.photosByElieVideoPriceTiers = Object.fromEntries(
    (Array.isArray(catalog.videoPriceTiers) ? catalog.videoPriceTiers : []).map((tier) => [tier.id, { ...tier }])
  );
  window.photosByElieApplyStorefrontPolicy(window.photosByElieData || {});
  window.photosByElieApplyStorefrontPolicy(window.photosByElieHomeData || {});
  return true;
};
const loadProductCatalog = async () => {
  const response = await fetch(productCatalogUrl, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Product catalog HTTP ${response.status}`);
  const catalog = await response.json();
  if (!applyProductCatalog(catalog)) throw new Error('Product catalog has no products.');
  return catalog;
};
window.photosByElieCatalogReady = window.photosByElieCatalogReady || loadProductCatalog().catch((error) => {
  console.warn(error?.message || 'Could not load the product catalog.');
  return null;
});
window.photosByElieVideoTier = window.photosByElieVideoTier || ((photo) => {
  const duration = Number(photo?.media?.video?.duration ?? photo?.duration ?? 0);
  if (duration < 10) return 'video_short';
  if (duration < 30) return 'video_medium';
  if (duration < 60) return 'video_long';
  if (duration < 180) return 'video_extended';
  return 'video_premium';
});
window.photosByElieVideoDownloadOption = window.photosByElieVideoDownloadOption || ((photo) => {
  const priceKey = window.photosByElieVideoTier(photo);
  const priceTier = window.photosByElieVideoPriceTiers?.[priceKey] || { price: 0 };
  return {
    id: 'video-original',
    type: 'video',
    label: 'Original video download',
    detail: 'Private original video file after purchase',
    price: Number(priceTier.price) || 0,
    priceKey,
  };
});
const readProductSettings = () => {
  try {
    const parsed = JSON.parse(localStorage.getItem(productSettingsKey) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};
const writeProductSettings = (settings) => {
  try {
    localStorage.setItem(productSettingsKey, JSON.stringify(settings));
  } catch {
    // Storage can be unavailable in strict private contexts.
  }
};
let productPriceDefaults = null;
const captureProductPriceDefaults = () => {
  if (productPriceDefaults || !Array.isArray(window.photosByElieResolutions)) return productPriceDefaults;
  productPriceDefaults = {
    options: Object.fromEntries((window.photosByElieResolutions || []).map((option) => [option.id, Number(option.price) || 0])),
    optionPrices: Object.fromEntries((window.photosByElieResolutions || []).map((option) => [option.id, { ...(option.prices || {}) }])),
    frames: Object.fromEntries((window.photosByElieFrameOptions || []).map((frame) => [frame.id, {
      price: Number(frame.price) || 0,
      prices: { ...(frame.prices || {}) },
    }])),
    shippingHandling: { ...(window.photosByElieShippingHandlingPrices || {}) },
    videoPriceTiers: Object.fromEntries(Object.entries(window.photosByElieVideoPriceTiers || {})
      .map(([id, tier]) => [id, Number(tier?.price) || 0])),
  };
  return productPriceDefaults;
};
const cleanPriceOverrides = (overrides = {}) => ({
  options: Object.fromEntries(Object.entries(overrides.options || {})
    .map(([id, value]) => [id, Math.max(0, Number(value) || 0)])),
  optionPrices: Object.fromEntries(Object.entries(overrides.optionPrices || {}).map(([id, prices]) => [id, (
    Object.fromEntries(Object.entries(prices || {})
      .map(([tier, value]) => [tier, Math.max(0, Number(value) || 0)]))
  )])),
  frames: Object.fromEntries(Object.entries(overrides.frames || {}).map(([id, frame]) => [id, {
    price: Math.max(0, Number(frame?.price) || 0),
    prices: Object.fromEntries(Object.entries(frame?.prices || {})
      .map(([optionId, value]) => [optionId, Math.max(0, Number(value) || 0)])),
  }])),
  shippingHandling: Object.fromEntries(Object.entries(overrides.shippingHandling || {})
    .map(([id, value]) => [id, Math.max(0, Number(value) || 0)])),
  videoPriceTiers: Object.fromEntries(Object.entries(overrides.videoPriceTiers || {})
    .map(([id, value]) => [id, Math.max(0, Number(value) || 0)])),
});
const applyProductPriceOverrides = () => {
  const defaults = captureProductPriceDefaults();
  if (!defaults) return {};
  const overrides = cleanPriceOverrides(readProductSettings().priceOverrides || {});
  (window.photosByElieResolutions || []).forEach((option) => {
    option.prices = { ...(defaults.optionPrices?.[option.id] || {}), ...(overrides.optionPrices?.[option.id] || {}) };
    option.price = overrides.options[option.id] ?? option.prices.original ?? defaults.options[option.id] ?? (Number(option.price) || 0);
    if (Object.prototype.hasOwnProperty.call(overrides.options, option.id) && option.prices.original !== undefined) {
      option.prices.original = option.price;
    }
  });
  (window.photosByElieFrameOptions || []).forEach((frame) => {
    const frameDefaults = defaults.frames[frame.id] || {};
    const frameOverrides = overrides.frames[frame.id] || {};
    frame.price = frameOverrides.price ?? frameDefaults.price ?? (Number(frame.price) || 0);
    frame.prices = { ...(frameDefaults.prices || {}), ...(frameOverrides.prices || {}) };
  });
  window.photosByElieShippingHandlingPrices = {
    ...(defaults.shippingHandling || {}),
    ...(overrides.shippingHandling || {}),
  };
  Object.entries(window.photosByElieVideoPriceTiers || {}).forEach(([id, tier]) => {
    const fallbackPrice = defaults.videoPriceTiers?.[id] ?? Number(tier?.price) ?? 20;
    tier.price = overrides.videoPriceTiers[id] ?? fallbackPrice;
  });
  return overrides;
};
const saveProductPriceOverrides = (overrides = {}) => {
  const settings = { ...readProductSettings(), priceOverrides: cleanPriceOverrides(overrides) };
  writeProductSettings(settings);
  applyProductPriceOverrides();
  window.dispatchEvent(new CustomEvent('photosbyelie:productsettingschange', { detail: settings }));
  return settings.priceOverrides;
};

window.photosByElieProductSettings = {
  read: readProductSettings,
  priceOverrides: () => cleanPriceOverrides(readProductSettings().priceOverrides || {}),
  savePriceOverrides: saveProductPriceOverrides,
  applyPriceOverrides: applyProductPriceOverrides,
  physicalProductsAvailable: () => physicalProductsAvailable,
  physicalProductsEnabled: () => (
    physicalProductsAvailable
    &&
    window.photosByElieInputMode.isLocalhost()
    && readProductSettings()[physicalProductsToggleKey] === true
  ),
  setPhysicalProductsEnabled: (enabled) => {
    if (!window.photosByElieInputMode.isLocalhost()) return false;
    const settings = {
      ...readProductSettings(),
      physicalProductsEnabled: false,
      [physicalProductsToggleKey]: physicalProductsAvailable && Boolean(enabled),
    };
    writeProductSettings(settings);
    window.dispatchEvent(new CustomEvent('photosbyelie:productsettingschange', { detail: settings }));
    return settings[physicalProductsToggleKey];
  }
};

syncInputModeClass();
desktopInputQuery?.addEventListener?.('change', () => {
  syncInputModeClass();
  window.dispatchEvent(new CustomEvent('photosbyelie:inputmodechange'));
});
window.addEventListener('keydown', (event) => {
  if (hasKeyboardInput || event.metaKey || event.ctrlKey || event.altKey) return;
  if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Tab'].includes(event.key)) return;
  hasKeyboardInput = true;
  syncInputModeClass();
  window.dispatchEvent(new CustomEvent('photosbyelie:inputmodechange'));
}, { capture: true });

const photoMetadataValue = (photo, label) => (
  (photo?.metadata || []).find((item) => item.label === label)?.value || ''
);

window.photosByElieRawSourceLabel = (photo) => {
  const sourceType = (photo?.sourceFiles || [])
    .map((source) => String(source?.type || '').trim().toUpperCase())
    .find((type) => rawSourceTypes.has(type));
  if (sourceType) return sourceType;
  const sourceText = [
    photo?.full,
    photoMetadataValue(photo, 'Original file'),
    photoMetadataValue(photo, 'Original size')
  ].filter(Boolean).join(' ').toUpperCase();
  const match = sourceText.match(/\b(DNG|NEF|CR2|CR3|ARW|RAF|ORF|RW2|RAW|PEF|SRW|RWL)\b/);
  return match?.[1] || '';
};

const normalizePublicMediaBase = (value) => String(value || '').trim().replace(/\/+$/, '');
const mediaConfig = window.photosByElieMediaConfig || {};
const mediaBaseStorageKey = 'photosbyelie-public-media-base';
const isLocalhostMediaPage = window.photosByElieInputMode.isLocalhost();
const mediaBaseFromQuery = (() => {
  try {
    return normalizePublicMediaBase(new URLSearchParams(window.location.search).get('mediaBase') || '');
  } catch {
    return '';
  }
})();
const isSafePublicMediaBase = (value) => {
  if (!value || isLocalhostMediaPage) return true;
  try {
    const url = new URL(value, window.location.href);
    const hostname = url.hostname.toLowerCase();
    return url.protocol === 'https:' && hostname !== 'localhost' && hostname !== '127.0.0.1' && hostname !== '::1';
  } catch {
    return false;
  }
};

if (mediaBaseFromQuery.toLowerCase() === 'local') {
  try {
    localStorage.removeItem(mediaBaseStorageKey);
  } catch {
    // Storage can be unavailable in strict private contexts.
  }
} else if (mediaBaseFromQuery && isLocalhostMediaPage) {
  try {
    localStorage.setItem(mediaBaseStorageKey, mediaBaseFromQuery);
  } catch {
    // Storage can be unavailable in strict private contexts.
  }
} else if (!isLocalhostMediaPage) {
  try {
    localStorage.removeItem(mediaBaseStorageKey);
  } catch {
    // Storage can be unavailable in strict private contexts.
  }
}

const storedMediaBase = (() => {
  if (!isLocalhostMediaPage) return '';
  try {
    return normalizePublicMediaBase(localStorage.getItem(mediaBaseStorageKey) || '');
  } catch {
    return '';
  }
})();
const configuredMediaBase = normalizePublicMediaBase(mediaConfig.publicBaseUrl);
const explicitMediaBase = mediaBaseFromQuery && mediaBaseFromQuery.toLowerCase() !== 'local'
  && isSafePublicMediaBase(mediaBaseFromQuery)
  ? mediaBaseFromQuery
  : '';
window.photosByEliePublicMediaBase = normalizePublicMediaBase(
  explicitMediaBase || storedMediaBase || (isLocalhostMediaPage ? window.photosByEliePublicMediaBase : '') || configuredMediaBase
);
window.photosByEliePublicMediaHostnames = new Set(mediaConfig.publicMediaHostnames || ['ec92009.github.io']);
window.photosByElieMediaStatus = () => ({
  baseUrl: window.photosByEliePublicMediaBase,
  requiresPublicMedia: window.photosByEliePublicMediaHostnames.has(window.location.hostname),
});

window.photosByEliePublicHiddenIds = new Set();
window.photosByElieIsPublicHidden = (photo) => (
  !window.photosByElieInputMode.isLocalhost()
  && Boolean(photo?.id)
  && window.photosByEliePublicHiddenIds.has(photo.id)
);
window.photosByElieFilterPublicHidden = (photos = []) => {
  if (window.photosByElieInputMode.isLocalhost() || !window.photosByEliePublicHiddenIds.size) return photos;
  return photos.filter((photo) => !window.photosByEliePublicHiddenIds.has(photo?.id));
};
window.photosByElieHiddenBlacklistReady = (async () => {
  const base = normalizePublicMediaBase(window.photosByEliePublicMediaBase);
  if (!base || window.photosByElieInputMode.isLocalhost()) return window.photosByEliePublicHiddenIds;
  try {
    const url = `${base}/hidden-blacklist.json?t=${Math.floor(Date.now() / 60000)}`;
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Hidden blacklist ${response.status}`);
    const payload = await response.json();
    const ids = Array.isArray(payload?.photo_ids) ? payload.photo_ids : [];
    window.photosByEliePublicHiddenIds = new Set(ids.filter((id) => typeof id === 'string' && id));
    window.dispatchEvent(new CustomEvent('photosbyelie:hiddenblacklistchange', {
      detail: { count: window.photosByEliePublicHiddenIds.size }
    }));
  } catch {
    window.photosByEliePublicHiddenIds = new Set();
  }
  return window.photosByEliePublicHiddenIds;
})();

window.photosByElieMediaKey = (photo, size = 'gallery') => {
  const preview = photo?.media?.publicPreview;
  if (preview?.allowed === false) return '';
  const key = size === 'detail' ? preview?.detailKey : preview?.galleryKey;
  return key || '';
};

window.photosByElieMediaUrl = (photo, size = 'gallery') => {
  const preview = photo?.media?.publicPreview;
  const direct = size === 'detail'
    ? (preview?.detailUrl || preview?.previewUrl)
    : (preview?.galleryUrl || preview?.thumbnailUrl);
  if (direct) return direct;
  const key = window.photosByElieMediaKey(photo, size);
  const base = normalizePublicMediaBase(window.photosByEliePublicMediaBase);
  if (base && key) return `${base}/${key.replace(/^\/+/, '')}`;
  return '';
};

window.photosByElieMediaSampleUrl = (photo, size = 'gallery') => {
  const key = window.photosByElieMediaKey(photo, size);
  if (!key || !isLocalhostMediaPage) return window.photosByElieMediaUrl(photo, size);
  return `/__photosbyelie/public-media/${key.replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/')}`;
};

window.photosByEliePrivateMediaUrl = (photo, productId = 'jpg-6mp') => {
  if (!isLocalhostMediaPage || !photo?.id || window.photosByElieIsVideo?.(photo)) return '';
  const renderKey = photo?.media?.privateDelivery?.renderKeys?.[productId]
    || (productId === 'jpg-6mp' ? `renders/${photo.id}_6mp.jpg` : '');
  if (!renderKey) return '';
  return `/__photosbyelie/private-media/${renderKey.replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/')}`;
};

window.photosByElieMediaType = (photo) => String(photo?.media?.type || photo?.type || "photo").toLowerCase();
window.photosByElieIsVideo = (photo) => window.photosByElieMediaType(photo) === "video";
window.photosByElieVideoDurationSeconds = (photo) => {
  const direct = Number(
    photo?.media?.video?.duration
    ?? photo?.media?.video?.durationSeconds
    ?? photo?.video?.duration
    ?? photo?.durationSeconds
    ?? 0
  );
  if (Number.isFinite(direct) && direct > 0) return direct;
  const raw = [
    window.photosByElieMetadataValue(photo, 'Duration'),
    window.photosByElieMetadataValue(photo, 'Original size'),
    window.photosByElieMetadataValue(photo, 'Preview file')
  ].filter(Boolean).join(' ');
  const secondsMatch = raw.match(/(\d+(?:\.\d+)?)\s*(?:seconds?|secs?|s)\b/i);
  if (secondsMatch) return Number(secondsMatch[1]) || 0;
  const clockMatch = raw.match(/\b(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:\.\d+)?\b/);
  if (!clockMatch) return 0;
  return (Number(clockMatch[1]) || 0) * 3600 + (Number(clockMatch[2]) || 0) * 60 + Number(clockMatch[3]);
};
window.photosByElieFormatVideoDuration = (seconds) => {
  const rounded = Math.round(Number(seconds) || 0);
  if (!Number.isFinite(rounded) || rounded <= 0) return '';
  if (rounded < 60) return `${rounded} sec`;
  const minutes = Math.floor(rounded / 60);
  const remainingSeconds = String(rounded % 60).padStart(2, '0');
  if (minutes < 60) return `${minutes}:${remainingSeconds}`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = String(minutes % 60).padStart(2, '0');
  return `${hours}:${remainingMinutes}:${remainingSeconds}`;
};
window.photosByElieVideoDurationLabel = (photo) => (
  window.photosByElieFormatVideoDuration(window.photosByElieVideoDurationSeconds(photo))
);
  window.photosByElieVideoPosterUrl = (photo) => (
    photo?.media?.publicPreview?.posterUrl
    || window.photosByElieMediaUrl(photo, "gallery")
  );

  const horizontalPanInstances = new WeakMap();
  window.photosByElieEnableHorizontalPan = (scroller, options = {}) => {
    if (!scroller) return null;
    const existing = horizontalPanInstances.get(scroller);
    if (existing) return existing;

    const interactiveSelector = options.interactiveSelector || [
      "a",
      "button",
      "input",
      "select",
      "textarea",
      "label",
      "video",
      "[contenteditable='true']",
      "[role='button']",
    ].join(",");
    let isDragging = false;
    let pointerId = null;
    let startX = 0;
    let startScrollLeft = 0;
    let moved = false;
    let suppressClick = false;
    const minDrag = 4;

    const canScroll = () => scroller.scrollWidth > scroller.clientWidth + 2;
    const refresh = () => {
      scroller.classList.toggle("is-pan-draggable", canScroll());
    };
    const isInteractiveTarget = (target) => (
      target instanceof Element
      && Boolean(target.closest(interactiveSelector))
    );
    const stopDrag = () => {
      if (!isDragging) return;
      isDragging = false;
      scroller.classList.remove("is-panning");
      if (pointerId !== null) {
        try {
          scroller.releasePointerCapture?.(pointerId);
        } catch {}
      }
      pointerId = null;
      if (moved) {
        suppressClick = true;
        window.setTimeout(() => {
          suppressClick = false;
        }, 0);
      }
    };

    const onPointerDown = (event) => {
      refresh();
      if (event.button !== 0 || !canScroll() || isInteractiveTarget(event.target)) return;
      isDragging = true;
      moved = false;
      pointerId = event.pointerId;
      startX = event.clientX;
      startScrollLeft = scroller.scrollLeft;
      scroller.classList.add("is-panning");
      scroller.setPointerCapture?.(pointerId);
      event.preventDefault();
    };
    const onPointerMove = (event) => {
      if (!isDragging || event.pointerId !== pointerId) return;
      const deltaX = event.clientX - startX;
      if (Math.abs(deltaX) >= minDrag) moved = true;
      scroller.scrollLeft = startScrollLeft - deltaX;
      event.preventDefault();
    };
    const onClick = (event) => {
      if (!suppressClick) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };

    scroller.addEventListener("pointerdown", onPointerDown);
    scroller.addEventListener("pointermove", onPointerMove);
    scroller.addEventListener("pointerup", stopDrag);
    scroller.addEventListener("pointercancel", stopDrag);
    scroller.addEventListener("lostpointercapture", stopDrag);
    scroller.addEventListener("click", onClick, true);
    scroller.addEventListener("scroll", refresh, { passive: true });
    const resizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(refresh) : null;
    resizeObserver?.observe(scroller);
    window.addEventListener("resize", refresh);
    window.requestAnimationFrame(refresh);

    const api = {
      refresh,
      destroy: () => {
        stopDrag();
        resizeObserver?.disconnect();
        window.removeEventListener("resize", refresh);
        scroller.removeEventListener("pointerdown", onPointerDown);
        scroller.removeEventListener("pointermove", onPointerMove);
        scroller.removeEventListener("pointerup", stopDrag);
        scroller.removeEventListener("pointercancel", stopDrag);
        scroller.removeEventListener("lostpointercapture", stopDrag);
        scroller.removeEventListener("click", onClick, true);
        scroller.removeEventListener("scroll", refresh);
        scroller.classList.remove("is-pan-draggable", "is-panning");
        horizontalPanInstances.delete(scroller);
      },
    };
    horizontalPanInstances.set(scroller, api);
    return api;
  };
  window.photosByElieRefreshHorizontalPan = (scroller) => {
    horizontalPanInstances.get(scroller)?.refresh?.();
  };

  window.photosByElieSourcePreviewUrl = (photo, mode = "media") => {
    if (!isLocalhostMediaPage || !photo?.id) return "";
    const path = encodeURIComponent(String(photo.id));
    return `/__photosbyelie/source-preview/${path}${mode === "info" ? "?info=1" : ""}`;
  };

  window.photosByElieOpenFinderPreview = async (photo, options = {}) => {
    const initialPhoto = photo || null;
    const optionItems = Array.isArray(options.items)
      ? options.items
      : Array.isArray(options.photos)
        ? options.photos
        : Array.isArray(options.sequence)
          ? options.sequence
          : [];
    const previewItems = optionItems
      .map((item) => item?.photo || item)
      .filter((item) => item?.id);
    let currentIndex = Number.isInteger(options.index)
      ? Math.max(0, Math.min(options.index, Math.max(0, previewItems.length - 1)))
      : previewItems.findIndex((item) => item.id === initialPhoto?.id);
    if (currentIndex < 0 && initialPhoto?.id) {
      previewItems.unshift(initialPhoto);
      currentIndex = 0;
    }
    const targetPhoto = previewItems[currentIndex] || initialPhoto;
    if (!targetPhoto?.id) return false;
    const owner = Boolean(options.owner);
    const isVideo = window.photosByElieIsVideo?.(targetPhoto) === true;
    const isPanoramaPreview = !isVideo && Boolean(window.photosByEliePhotoIsPanorama?.(targetPhoto));
    const title = String(targetPhoto.title || targetPhoto.id || "Preview");
    const sourceLabel = String(targetPhoto?.sourceFiles?.[0]?.path || targetPhoto?.sourceFiles?.[0]?.label || targetPhoto.id || "unknown source");
    const escapePreviewHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#39;",
    }[char] || char));
    const existing = document.querySelector(".detail-fullscreen-preview");
    existing?.remove();

    const modal = document.createElement("div");
    modal.className = `detail-fullscreen-preview finder-media-preview has-info-panel${owner ? " is-owner-preview" : ""}${isPanoramaPreview ? " is-panorama-preview" : ""}`;
    modal.tabIndex = -1;
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-label", `${isVideo ? "Video" : "Photo"} preview: ${title}`);
    modal.dataset.mediaType = isVideo ? "video" : "photo";
    modal.innerHTML = `
      <div class="finder-preview-stage" data-finder-preview-stage>
        <div class="finder-preview-loading">Loading preview</div>
        ${isPanoramaPreview ? `<button class="finder-preview-pano-toggle" type="button" data-finder-preview-pano-toggle aria-pressed="false">${translate("preview.full_height")}</button>` : ""}
      </div>
      ${previewItems.length > 1 ? `
        <button class="finder-preview-nav is-prev" type="button" data-finder-preview-prev aria-label="Previous preview">‹</button>
        <button class="finder-preview-nav is-next" type="button" data-finder-preview-next aria-label="Next preview">›</button>
      ` : ""}
      <section class="finder-preview-info-panel" data-finder-preview-info>
        <p class="eyebrow">${owner ? "Owner source preview" : "Preview"}</p>
        <h2>${escapePreviewHtml(title)}</h2>
      </section>
    `;
    const stage = modal.querySelector("[data-finder-preview-stage]");
    const infoPanel = modal.querySelector("[data-finder-preview-info]");
    const panoToggle = modal.querySelector("[data-finder-preview-pano-toggle]");
    const contextUrl = window.photosByElieMediaUrl(targetPhoto, "detail") || window.photosByElieMediaUrl(targetPhoto, "gallery") || "";
    const contextPoster = isVideo ? (window.photosByElieVideoPosterUrl?.(targetPhoto) || window.photosByElieMediaUrl(targetPhoto, "gallery") || "") : "";
    document.body.classList.add("detail-fullscreen-active");
    document.body.append(modal);
    const panoPan = isPanoramaPreview
      ? window.photosByElieEnableHorizontalPan?.(stage, { interactiveSelector: "a,button,input,select,textarea,label,video,[contenteditable='true'],[role='button']" })
      : null;

    const close = () => {
      document.body.classList.remove("detail-fullscreen-active");
      panoPan?.destroy?.();
      modal.remove();
      window.removeEventListener("keydown", onKeydown, true);
    };
    const openAdjacent = (delta) => {
      if (previewItems.length < 2) return false;
      const nextIndex = (currentIndex + delta + previewItems.length) % previewItems.length;
      const nextPhoto = previewItems[nextIndex];
      if (!nextPhoto?.id) return false;
      close();
      window.photosByElieOpenFinderPreview?.(nextPhoto, {
        ...options,
        items: previewItems,
        index: nextIndex,
      });
      return true;
    };
    const centerPanoStage = () => {
      if (!stage || !modal.classList.contains("is-pano-scroll")) return;
      stage.scrollLeft = Math.max(0, (stage.scrollWidth - stage.clientWidth) / 2);
      panoPan?.refresh?.();
    };
    const setPanoPreviewMode = (scrollMode) => {
      if (!panoToggle) return;
      modal.classList.toggle("is-pano-scroll", scrollMode);
      panoToggle.textContent = translate(scrollMode ? "preview.fit_width" : "preview.full_height");
      panoToggle.setAttribute("aria-label", translate(scrollMode ? "preview.fit_width" : "preview.full_height"));
      panoToggle.setAttribute("aria-pressed", String(scrollMode));
      window.requestAnimationFrame(centerPanoStage);
      window.setTimeout(centerPanoStage, 80);
      window.setTimeout(() => panoPan?.refresh?.(), 120);
    };
    const metadataRows = (extraRows = []) => [
      ["Media id", targetPhoto.id],
      ["Kind", isVideo ? "Video" : "Photo"],
      ...extraRows,
    ].filter(([, value]) => String(value ?? "").trim());
    const renderInfo = ({ eyebrow = owner ? "Owner source preview" : "Preview", state = "", rows = [], note = "" } = {}) => {
      if (!infoPanel) return;
      infoPanel.classList.toggle("is-error", state === "error");
      infoPanel.classList.toggle("is-warning", state === "warning");
      infoPanel.innerHTML = `
        <p class="eyebrow">${escapePreviewHtml(eyebrow)}</p>
        <h2>${escapePreviewHtml(title)}</h2>
        <dl>
          ${metadataRows(rows).map(([label, value]) => `
            <div><dt>${escapePreviewHtml(label)}</dt><dd>${escapePreviewHtml(value)}</dd></div>
          `).join("")}
        </dl>
        ${note ? `<p class="finder-preview-note">${escapePreviewHtml(note)}</p>` : ""}
      `;
    };
    function onKeydown(event) {
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        if (event.target instanceof HTMLElement && event.target.closest("video")) return;
        if (openAdjacent(event.key === "ArrowRight" ? 1 : -1)) event.preventDefault();
        return;
      }
      if (event.key !== "Escape" && event.key !== " ") return;
      if (event.key === " " && event.target instanceof HTMLElement && event.target.closest("video")) return;
      event.preventDefault();
      close();
    }
    const showEmptyPreview = (message) => {
      if (!stage) return;
      stage.innerHTML = `<div class="finder-preview-empty">${escapePreviewHtml(message)}</div>`;
    };
    const replaceStageMedia = (...nodes) => {
      if (!stage) return;
      stage.replaceChildren(...nodes.filter(Boolean));
      if (panoToggle) stage.append(panoToggle);
      panoPan?.refresh?.();
    };
    const appendPhoto = (src, { sourceType = "", attemptedSourceLabel = sourceLabel, context = false, onError = null } = {}) => {
      if (!stage) return;
      const image = new Image();
      image.alt = title;
      image.decoding = "async";
      image.addEventListener("error", () => {
        if (typeof onError === "function") {
          onError({
            sourceType,
            attemptedSourceLabel,
            reason: "The browser could not load or decode the image.",
          });
        } else {
          showEmptyPreview("Preview unavailable");
        }
      }, { once: true });
      if (isPanoramaPreview) {
        image.addEventListener("load", () => {
          centerPanoStage();
          panoPan?.refresh?.();
        }, { once: true });
      }
      replaceStageMedia(image);
      stage.classList.toggle("is-context-preview", Boolean(context));
      image.src = src;
    };
    const appendVideo = (src, poster = "", { sourceType = "", attemptedSourceLabel = sourceLabel, context = false, onError = null } = {}) => {
      if (!stage) return;
      const video = document.createElement("video");
      video.controls = true;
      video.autoplay = !context;
      video.playsInline = true;
      video.preload = "metadata";
      if (poster) video.poster = poster;
      video.addEventListener("error", () => {
        const mediaError = video.error;
        if (typeof onError === "function") {
          onError({
            sourceType,
            attemptedSourceLabel,
            reason: mediaError?.message || "The browser could not load, decode, or play the video.",
          });
        } else {
          showEmptyPreview("Video preview unavailable");
        }
      }, { once: true });
      replaceStageMedia(video);
      stage.classList.toggle("is-context-preview", Boolean(context));
      video.src = src;
    };
    const showContextPreview = (note = "") => {
      if (!contextUrl) {
        showEmptyPreview("No lower-resolution context preview is available");
        return;
      }
      const label = note || (owner ? "Source preview unavailable; this is a lower-resolution context preview." : "");
      if (isVideo) appendVideo(contextUrl, contextPoster, { sourceType: "public short MP4", attemptedSourceLabel: contextUrl, context: true });
      else appendPhoto(contextUrl, { sourceType: "public _1800", attemptedSourceLabel: contextUrl, context: true });
      if (label && stage) {
        const badge = document.createElement("p");
        badge.className = "finder-preview-context-label";
        badge.textContent = label;
        stage.append(badge);
      }
    };
    const showOwnerFailure = ({ reason, attemptedSourceType = "", attemptedSourceLabel = sourceLabel } = {}) => {
      showEmptyPreview("Original source preview unavailable");
      stage?.classList?.remove("is-context-preview");
      renderInfo({
        eyebrow: "Owner original preview failed",
        state: "error",
        rows: [
          ["Attempted source", attemptedSourceType || "original/source"],
          ["Path label", attemptedSourceLabel || "unknown"],
          ["Reason", reason || "The browser could not load this preview."],
        ],
        note: "Owner mode does not substitute public or lower-resolution previews.",
      });
    };

    modal.addEventListener("click", (event) => {
      if (event.target === modal) close();
    });
    modal.addEventListener("touchend", (event) => {
      if (event.target !== modal) return;
      event.preventDefault();
      close();
    }, { passive: false });
    modal.querySelector("[data-finder-preview-prev]")?.addEventListener("click", (event) => {
      event.stopPropagation();
      openAdjacent(-1);
    });
    modal.querySelector("[data-finder-preview-next]")?.addEventListener("click", (event) => {
      event.stopPropagation();
      openAdjacent(1);
    });
    panoToggle?.addEventListener("click", (event) => {
      event.stopPropagation();
      setPanoPreviewMode(!modal.classList.contains("is-pano-scroll"));
    });
    setPanoPreviewMode(false);
    window.addEventListener("keydown", onKeydown, true);
    modal.focus({ preventScroll: true });

    if (owner) {
      const infoUrl = window.photosByElieSourcePreviewUrl(targetPhoto, "info");
      renderInfo({ rows: [["Attempted source", "original/source"], ["Path label", sourceLabel], ["Status", "Loading"]] });
      if (!infoUrl) {
        showOwnerFailure({ reason: "Owner source previews are only available from localhost." });
        return true;
      }
      try {
        const response = await fetch(infoUrl, { cache: "no-store", credentials: "same-origin" });
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.ok) {
          showOwnerFailure({
            attemptedSourceType: payload?.sourceType || "original/source",
            attemptedSourceLabel: payload?.sourceLabel || sourceLabel,
            reason: payload?.error || `Source preview endpoint returned ${response.status}.`,
          });
          return true;
        }
        const previewUrl = payload.previewUrl || window.photosByElieSourcePreviewUrl(targetPhoto);
        const isPublicFallback = payload.isOriginal === false;
        renderInfo({
          eyebrow: isPublicFallback ? "Public preview" : "Owner original preview",
          rows: [
            ["Source", payload.sourceType || "original/source"],
            ["Path", payload.sourceLabel || sourceLabel],
            ["Status", isPublicFallback ? "Loaded public media, matching regular visitor delivery" : "Loaded original from localhost source"],
          ],
        });
        const handleSourceLoadError = ({ sourceType, attemptedSourceLabel, reason }) => {
          showOwnerFailure({
            attemptedSourceType: sourceType,
            attemptedSourceLabel,
            reason,
          });
        };
        if (payload.mediaType === "video") {
          appendVideo(previewUrl, "", {
            sourceType: payload.sourceType,
            attemptedSourceLabel: payload.sourceLabel,
            onError: handleSourceLoadError,
          });
        } else {
          appendPhoto(previewUrl, {
            sourceType: payload.sourceType,
            attemptedSourceLabel: payload.sourceLabel,
            onError: handleSourceLoadError,
          });
        }
      } catch (error) {
        showOwnerFailure({ reason: error?.message || "Could not contact the owner source preview endpoint." });
      }
      return true;
    }

    if (!contextUrl) {
      showEmptyPreview("Preview unavailable");
      renderInfo({
        eyebrow: "Preview failed",
        state: "error",
        rows: [["Attempted source", "public detail"], ["Reason", "No public detail preview URL is available."]],
      });
      return true;
    }
    renderInfo({
      rows: [
        ["Source", isVideo ? "public short MP4" : "public _1800"],
        ["Path", contextUrl],
      ],
    });
    if (isVideo) appendVideo(contextUrl, contextPoster, { sourceType: "public short MP4", attemptedSourceLabel: contextUrl });
    else appendPhoto(contextUrl, { sourceType: "public _1800", attemptedSourceLabel: contextUrl });
    return true;
  };

  window.photosByElieSourceEditApps = async (photo) => {
    if (!isLocalhostMediaPage || !photo?.id) return [];
    if (window.photosByElieIsVideo?.(photo)) return [];
    return [{
      name: "Pixelmator Pro",
      bundleId: "com.pixelmatorteam.pixelmator.x",
      path: "/Applications/Pixelmator Pro.app",
    }];
  };

  window.photosByElieSourceEdits = async () => {
    if (!isLocalhostMediaPage) return { ok: false, files: [] };
    const response = await fetch("/__photosbyelie/source-edits", {
      cache: "no-store",
      credentials: "same-origin",
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok) {
      throw new Error(payload?.error || `Could not load Pixelmator edits (${response.status}).`);
    }
    return payload;
  };

  const normalizedPixelmatorEditStem = (value) => {
    const name = String(value || "").split(/[\\/]/).pop() || "";
    return name
      .replace(/\.[^.]+$/, "")
      .replace(/\.photosbyelie-edit$/i, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  };

  const sourceEditMatchStems = (photo) => {
    const stems = new Set();
    const add = (value) => {
      const stem = normalizedPixelmatorEditStem(value);
      if (stem) stems.add(stem);
    };
    (photo?.sourceFiles || []).forEach((source) => {
      add(source?.path);
      add(source?.label);
    });
    (photo?.metadata || []).forEach((entry) => {
      const label = String(entry?.label || "").trim().toLowerCase();
      if (label === "original file" || label === "source file") add(entry?.value);
    });
    add(photo?.title);
    add(photo?.id);
    return stems;
  };

  window.photosByElieMatchingSourceEdit = (photo, editsPayload) => {
    const stems = sourceEditMatchStems(photo);
    const files = Array.isArray(editsPayload?.files) ? editsPayload.files : [];
    return files.find((file) => stems.has(normalizedPixelmatorEditStem(file?.name || file?.path || ""))) || null;
  };

  window.photosByElieImportSourceEdit = async (photo, edit) => {
    if (!isLocalhostMediaPage || !photo?.id || !edit?.name) {
      throw new Error("A matching Pixelmator export is required before importing.");
    }
    const response = await fetch("/__photosbyelie/source-edit-import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ media_id: photo.id, edit_name: edit.name }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok) {
      throw new Error(payload?.error || `Could not import edited version (${response.status}).`);
    }
    return payload;
  };

  window.photosByElieImportAllSourceEdits = async () => {
    if (!isLocalhostMediaPage) {
      throw new Error("Edited-version imports are only available from localhost.");
    }
    const response = await fetch("/__photosbyelie/source-edit-import-all", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: "{}",
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok) {
      throw new Error(payload?.error || `Could not import exported edits (${response.status}).`);
    }
    return payload;
  };

  window.photosByElieEditSourceWith = async (photo) => {
    if (!isLocalhostMediaPage || !photo?.id) {
      throw new Error("Source editing is only available from localhost.");
    }
    const response = await fetch("/__photosbyelie/source-edit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ media_id: photo.id }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok) {
      throw new Error(payload?.error || `Could not open source media in Pixelmator Pro (${response.status}).`);
    }
    return payload;
  };

  window.photosByElieShowMediaContextMenu = (photo, event, options = {}) => {
    if (!photo?.id || !(event instanceof MouseEvent)) return false;
    const owner = Boolean(options.owner);
    event.preventDefault();
    document.querySelector(".media-context-menu")?.remove();
    const menu = document.createElement("div");
    menu.className = "media-context-menu";
    menu.setAttribute("role", "menu");
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      document.removeEventListener("pointerdown", closeOnPointerDown, true);
      document.removeEventListener("contextmenu", closeOnPointerDown, true);
      document.removeEventListener("keydown", closeOnKey, true);
      menu.remove();
    };
    const runAndClose = async (action) => {
      close();
      await action();
    };
    const makeButton = (label, action, { closeOnClick = true } = {}) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.setAttribute("role", "menuitem");
      button.addEventListener("click", async () => {
        if (closeOnClick) await runAndClose(action);
        else await action(button);
      });
      menu.append(button);
      return button;
    };
    makeButton("Preview", () => window.photosByElieOpenFinderPreview?.(photo, {
      owner,
      items: options.previewItems,
      index: options.previewIndex,
    }));
    if (owner) {
      if (!window.photosByElieIsVideo?.(photo)) {
        makeButton("Edit in Pixelmator Pro", async () => {
          try {
            const result = await window.photosByElieEditSourceWith(photo);
            window.dispatchEvent(new CustomEvent("photosbyelie:sourceedit", { detail: result }));
          } catch (error) {
            window.alert?.(String(error?.message || "Could not open source media in Pixelmator Pro."));
          }
        });
        const importEditButton = makeButton("Import edited version", async () => {}, { closeOnClick: false });
        importEditButton.hidden = true;
        importEditButton.disabled = true;
        importEditButton.addEventListener("click", async () => {
          if (!importEditButton._pixelmatorEdit) return;
          try {
            const result = await window.photosByElieImportSourceEdit(photo, importEditButton._pixelmatorEdit);
            close();
            window.dispatchEvent(new CustomEvent("photosbyelie:sourceeditimport", { detail: result }));
            window.alert?.(result.message || "Edited version imported.");
          } catch (error) {
            window.alert?.(String(error?.message || "Could not import edited version."));
          }
        });
        window.photosByElieSourceEdits()
          .then((edits) => {
            if (closed) return;
            const match = window.photosByElieMatchingSourceEdit(photo, edits);
            if (!match) return;
            importEditButton._pixelmatorEdit = match;
            importEditButton.hidden = false;
            importEditButton.disabled = false;
          })
          .catch(() => {});
      }
      makeButton("Show Pixelmator edits", async () => {
        try {
          const result = await window.photosByElieSourceEdits();
          window.dispatchEvent(new CustomEvent("photosbyelie:sourceedits", { detail: result }));
          const label = `${result.count || 0} file${Number(result.count || 0) === 1 ? "" : "s"} in ${result.folder || "pixelmator.pro.edits"}`;
          window.alert?.(label);
        } catch (error) {
          window.alert?.(String(error?.message || "Could not load Pixelmator edits."));
        }
      });
    }
    if (typeof options.onOpenDetail === "function") {
      makeButton("Open detail", options.onOpenDetail);
    }
    document.body.append(menu);
    const rect = menu.getBoundingClientRect();
    const left = Math.min(event.clientX, window.innerWidth - rect.width - 8);
    const top = Math.min(event.clientY, window.innerHeight - rect.height - 8);
    menu.style.left = `${Math.max(8, left)}px`;
    menu.style.top = `${Math.max(8, top)}px`;
    function closeOnPointerDown(pointerEvent) {
      if (pointerEvent.target instanceof Node && menu.contains(pointerEvent.target)) return;
      close();
    }
    const closeOnKey = (keyEvent) => {
      if (keyEvent.key !== "Escape") return;
      close();
    };
    window.setTimeout(() => {
      document.addEventListener("pointerdown", closeOnPointerDown, true);
      document.addEventListener("contextmenu", closeOnPointerDown, true);
      document.addEventListener("keydown", closeOnKey, true);
    }, 0);
    return true;
  };

  window.photosByElieMetadataValue = (photo, label) => (
    (photo?.metadata || []).find((item) => item.label === label)?.value || ''
  );

window.photosByEliePreviewDimensions = (photo) => {
  const actual = photo?.previewDimensions || photo?.media?.publicPreview?.dimensions;
  if (actual?.width && actual?.height) {
    return { width: Number(actual.width), height: Number(actual.height) };
  }
  const video = photo?.media?.video || photo?.video;
  if (video?.width && video?.height) {
    return { width: Number(video.width), height: Number(video.height) };
  }
  const value = window.photosByElieMetadataValue(photo, 'Preview file')
    || window.photosByElieMetadataValue(photo, 'Original size');
  const match = String(value).match(/(\d+)\s*x\s*(\d+)/i);
  if (!match) return null;
  return { width: Number(match[1]), height: Number(match[2]) };
};

window.photosByEliePhotoAspectStyle = (photo) => {
  const dimensions = window.photosByEliePreviewDimensions(photo);
  if (!dimensions?.width || !dimensions?.height) return '';
  return ` style="--photo-aspect-ratio:${dimensions.width} / ${dimensions.height}"`;
};

window.photosByEliePhotoIsPanorama = (photo) => {
  const dimensions = window.photosByEliePreviewDimensions(photo);
  return Boolean(dimensions?.width && dimensions?.height && dimensions.width / dimensions.height >= 2.1);
};

window.photosByEliePhotoOrientation = (photo) => {
  const dimensions = window.photosByEliePreviewDimensions(photo);
  if (!dimensions?.width || !dimensions?.height) return 'unknown';
  if (window.photosByEliePhotoIsPanorama(photo)) return 'pano';
  const ratio = dimensions.width / dimensions.height;
  if (ratio > 1.12) return 'landscape';
  if (ratio < .9) return 'portrait';
  return 'square';
};

window.photosByEliePhotoFilter = (() => {
  const defaultState = {
    query: '',
    collection: 'all',
    origin: 'all',
    orientation: 'all',
    mediaType: 'all',
    minSize: 'all',
    mood: 'all',
    subject: 'all',
    sort: 'newest',
    dateFrom: '',
    dateTo: ''
  };
  const normalizeState = (state = {}) => ({ ...defaultState, ...state });
  const metadataValue = (photo, label) => window.photosByElieMetadataValue?.(photo, label) || '';
  const photoOrigin = (photo, collectionKey = '') => (
    window.photosByEliePhotoOrigin?.(photo, collectionKey)
    || (collectionKey === 'ai' ? 'ai' : 'camera')
  );
  const mediaType = (photo) => (window.photosByElieIsVideo?.(photo) ? 'video' : 'photo');
  const verifiedMegapixels = (photo) => (
    window.photosByElieVerifiedMegapixels ? window.photosByElieVerifiedMegapixels(photo) : Number(photo?.megapixels) || 0
  );
  const durationSeconds = (photo) => window.photosByElieVideoDurationSeconds?.(photo) || 0;
  const maxAvailablePrice = (photo) => {
    const available = window.photosByElieAvailableResolutions
      ? window.photosByElieAvailableResolutions(photo, window.photosByElieResolutions || [])
      : [];
    return Math.max(0, ...available.map((option) => option.price || 0));
  };
  const parseCaptureTime = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return 0;
    const capturedMatch = raw.match(/^(\d{4}):(\d{2}):(\d{2})\s+(.+)$/);
    if (capturedMatch) {
      return Date.parse(`${capturedMatch[1]}-${capturedMatch[2]}-${capturedMatch[3]}T${capturedMatch[4]}`) || 0;
    }
    const dateMatch = raw.match(/\b(\d{4})[:/-]?(\d{2})[:/-]?(\d{2})(?:[ T:_-]+(\d{2}):?(\d{2})(?::?(\d{2}))?)?/);
    if (!dateMatch) return 0;
    const hour = dateMatch[4] || '00';
    const minute = dateMatch[5] || '00';
    const second = dateMatch[6] || '00';
    return Date.parse(`${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}T${hour}:${minute}:${second}`) || 0;
  };
  const captureTime = (photo) => [
    metadataValue(photo, 'Captured'),
    photo?.id,
    photo?.title,
    photo?.caption,
    photo?.full
  ].map(parseCaptureTime).find(Boolean) || 0;
  const dateFilterValue = (value) => {
    const normalized = String(value || '').trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : '';
  };
  const dateRangeBoundary = (value, edge) => {
    const normalized = dateFilterValue(value);
    if (!normalized) return 0;
    const suffix = edge === 'end' ? 'T23:59:59.999' : 'T00:00:00.000';
    return Date.parse(`${normalized}${suffix}`) || 0;
  };
  const normalizeSearchValue = (value) => String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  const searchTerms = (state = {}) => normalizeSearchValue(state.query)
    .split(/\s+/)
    .filter(Boolean);
  const searchTokens = (value) => normalizeSearchValue(value)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const editDistanceWithin = (left, right, maxDistance) => {
    if (!left || !right) return false;
    if (Math.abs(left.length - right.length) > maxDistance) return false;
    const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
    for (let i = 1; i <= left.length; i += 1) {
      let best = i;
      const current = [i];
      for (let j = 1; j <= right.length; j += 1) {
        const cost = left[i - 1] === right[j - 1] ? 0 : 1;
        const value = Math.min(
          previous[j] + 1,
          current[j - 1] + 1,
          previous[j - 1] + cost
        );
        current[j] = value;
        if (value < best) best = value;
      }
      if (best > maxDistance) return false;
      previous.splice(0, previous.length, ...current);
    }
    return previous[right.length] <= maxDistance;
  };
  const fuzzyTermMatches = (term, text, tokens = searchTokens(text)) => {
    if (!term) return true;
    if (text.includes(term)) return true;
    if (term.length < 3) return false;
    const maxDistance = term.length >= 7 ? 2 : 1;
    return tokens.some((token) => (
      token.startsWith(term)
      || (token.length >= 4 && term.startsWith(token) && term.length - token.length <= 2)
      || (token.length <= 24 && editDistanceWithin(term, token, maxDistance))
    ));
  };
  const searchText = (photo, context = {}) => [
    photo?.title,
    photo?.caption,
    photo?.full,
    photo?.id,
    metadataValue(photo, 'Keywords'),
    metadataValue(photo, 'Description'),
    metadataValue(photo, 'Original file'),
    metadataValue(photo, 'Original size'),
    metadataValue(photo, 'Preview file'),
    Array.isArray(photo?.keywords) ? photo.keywords.join(' ') : photo?.keywords,
    context.collectionTitle,
    typeof context.extraSearchText === 'function' ? context.extraSearchText(photo) : context.extraSearchText
  ].filter(Boolean).join(' ');
  const normalizedSearchText = (photo, context = {}) => normalizeSearchValue(searchText(photo, context));
  const matchesSearchTerms = (photo, state = {}, context = {}) => {
    const terms = searchTerms(state);
    if (!terms.length) return true;
    const text = normalizedSearchText(photo, context);
    const tokens = searchTokens(text);
    return terms.every((term) => fuzzyTermMatches(term, text, tokens));
  };
  const moodTags = (photo, context = {}) => {
    const text = normalizedSearchText(photo, context);
    const tags = new Set();
    if (/(sunset|sunrise|gold|yellow|orange|red|beach|desert|summer|warm)/.test(text)) tags.add('warm');
    if (/(ocean|sea|river|water|blue|snow|winter|harbor|harbour|atlantic|seine|cool)/.test(text)) tags.add('cool');
    if (/(gray|grey|unsaturated|black|white|interior|church|museum|palace|castle|architecture)/.test(text)) tags.add('neutral');
    if (/(art|garden|flower|green|color|colour|vivid|market|festival)/.test(text)) tags.add('vivid');
    return tags.size ? tags : new Set(['neutral']);
  };
  const subjectTags = (photo, context = {}) => {
    const text = normalizedSearchText(photo, context);
    const tags = new Set();
    if (/(architecture|church|castle|chateau|fortress|palace|monastery|building|interior|invalides|versailles)/.test(text)) tags.add('architecture');
    if (/(ocean|sea|river|water|beach|harbor|harbour|coast|atlantic|seine|boat|bateau)/.test(text)) tags.add('water');
    if (/(art|museum|statue|monet|painting|gallery|sculpture)/.test(text)) tags.add('art');
    if (/(family|person|people|child|mom|bar mitzvah|portrait)/.test(text)) tags.add('people');
    if (/(garden|park|flower|tree|mountain|animal|nature|landscape)/.test(text)) tags.add('nature');
    if (/(city|street|travel|paris|lisbon|lisboa|mexico|slovakia|france|usa|portugal|spain)/.test(text)) tags.add('city');
    return tags.size ? tags : new Set(['other']);
  };
  const minSizeThreshold = (state = {}) => {
    const threshold = Number(state.minSize || 0);
    return Number.isFinite(threshold) && threshold > 0 ? threshold : 0;
  };
  const matchesPhoto = (photo, state = {}, context = {}) => {
    const filterState = normalizeState(state);
    if (!matchesSearchTerms(photo, filterState, context)) return false;
    if (filterState.collection !== 'all' && context.collectionKey !== filterState.collection) return false;
    if (filterState.origin !== 'all' && photoOrigin(photo, context.collectionKey) !== filterState.origin) return false;
    if (filterState.orientation !== 'all' && window.photosByEliePhotoOrientation(photo) !== filterState.orientation) return false;
    const itemMediaType = mediaType(photo);
    if (filterState.mediaType !== 'all' && itemMediaType !== filterState.mediaType) return false;
    const threshold = minSizeThreshold(filterState);
    if (threshold) {
      if (itemMediaType === 'video' && filterState.mediaType !== 'video') return false;
      const metric = itemMediaType === 'video' ? durationSeconds(photo) : verifiedMegapixels(photo);
      if (metric < threshold) return false;
    }
    if (filterState.mood !== 'all') {
      if (itemMediaType === 'video') return false;
      if (!moodTags(photo, context).has(filterState.mood)) return false;
    }
    if (filterState.subject !== 'all' && !subjectTags(photo, context).has(filterState.subject)) return false;
    const fromDate = dateRangeBoundary(filterState.dateFrom, 'start');
    const toDate = dateRangeBoundary(filterState.dateTo, 'end');
    if (fromDate || toDate) {
      const captured = captureTime(photo);
      if (!captured) return false;
      if (fromDate && captured < fromDate) return false;
      if (toDate && captured > toDate) return false;
    }
    return true;
  };
  const sortItems = (items = [], state = {}, context = {}) => {
    const filterState = normalizeState(state);
    const photoFor = context.photoFor || ((item) => item);
    const sorted = [...items];
    if (filterState.sort === 'newest') sorted.sort((a, b) => captureTime(photoFor(b)) - captureTime(photoFor(a)));
    if (filterState.sort === 'oldest') sorted.sort((a, b) => captureTime(photoFor(a)) - captureTime(photoFor(b)));
    if (filterState.sort === 'title') sorted.sort((a, b) => String(photoFor(a)?.title || '').localeCompare(String(photoFor(b)?.title || '')));
    if (filterState.sort === 'megapixels-desc') sorted.sort((a, b) => verifiedMegapixels(photoFor(b)) - verifiedMegapixels(photoFor(a)));
    if (filterState.sort === 'megapixels-asc') sorted.sort((a, b) => verifiedMegapixels(photoFor(a)) - verifiedMegapixels(photoFor(b)));
    if (filterState.sort === 'duration-desc') sorted.sort((a, b) => durationSeconds(photoFor(b)) - durationSeconds(photoFor(a)));
    if (filterState.sort === 'duration-asc') sorted.sort((a, b) => durationSeconds(photoFor(a)) - durationSeconds(photoFor(b)));
    if (filterState.sort === 'price-desc') sorted.sort((a, b) => maxAvailablePrice(photoFor(b)) - maxAvailablePrice(photoFor(a)));
    if (filterState.sort === 'price-asc') sorted.sort((a, b) => maxAvailablePrice(photoFor(a)) - maxAvailablePrice(photoFor(b)));
    return sorted;
  };
  const adaptiveOptionSets = {
    photoMinSize: [
      ['all', 'gallery.any_size'],
      ['1', 'gallery.size_1mp'],
      ['3', 'gallery.size_3mp'],
      ['6', 'gallery.size_6mp'],
      ['10', 'gallery.size_10mp'],
      ['20', 'gallery.size_20mp'],
    ],
    videoMinSize: [
      ['all', 'gallery.any_duration'],
      ['5', 'gallery.duration_5s'],
      ['10', 'gallery.duration_10s'],
      ['20', 'gallery.duration_20s'],
      ['30', 'gallery.duration_30s'],
      ['60', 'gallery.duration_60s'],
    ],
    photoSortMetrics: [
      ['megapixels-desc', 'gallery.largest_mp'],
      ['megapixels-asc', 'gallery.smallest_mp'],
    ],
    videoSortMetrics: [
      ['duration-desc', 'gallery.longest_duration'],
      ['duration-asc', 'gallery.shortest_duration'],
    ],
  };
  const setOptions = (select, options, translate) => {
    if (!select) return false;
    const previous = select.value;
    select.innerHTML = options.map(([value, key]) => `<option value="${value}" data-i18n="${key}">${translate(key)}</option>`).join('');
    if ([...select.options].some((option) => option.value === previous)) {
      select.value = previous;
      return false;
    }
    select.value = 'all';
    return previous !== select.value;
  };
  const labelTextForControl = (control) => control?.closest('label')?.querySelector('span');
  const syncAdaptiveControls = ({ root, state, filterSelector, translate }) => {
    if (!root || !state || !filterSelector) return state;
    const t = translate || ((key) => key);
    const nextState = state;
    const videoMode = nextState.mediaType === 'video';
    const control = (key) => root.querySelector(`[${filterSelector}="${key}"]`);
    const minSize = control('minSize');
    const minLabel = labelTextForControl(minSize);
    if (minLabel) minLabel.textContent = t(videoMode ? 'gallery.min_duration' : 'gallery.min_size');
    const minOptions = videoMode ? adaptiveOptionSets.videoMinSize : adaptiveOptionSets.photoMinSize;
    if (setOptions(minSize, minOptions, t)) nextState.minSize = minSize?.value || 'all';

    const mood = control('mood');
    const moodLabel = mood?.closest('label');
    if (mood) {
      mood.disabled = videoMode;
      mood.title = videoMode ? t('gallery.mood_photos_only') : '';
      moodLabel?.classList.toggle('is-disabled', videoMode);
      if (videoMode && nextState.mood !== 'all') {
        nextState.mood = 'all';
        mood.value = 'all';
      }
    }

    const sort = control('sort');
    if (sort) {
      const previousSort = sort.value || nextState.sort;
      const metricOptions = videoMode ? adaptiveOptionSets.videoSortMetrics : adaptiveOptionSets.photoSortMetrics;
      const baseOptions = [
        ['newest', 'gallery.newest'],
        ['oldest', 'gallery.oldest'],
        ['collection', 'gallery.collection_order'],
        ['title', 'gallery.title'],
        ...metricOptions,
        ['price-desc', 'gallery.highest_price'],
        ['price-asc', 'gallery.lowest_price'],
      ];
      sort.innerHTML = baseOptions.map(([value, key]) => `<option value="${value}" data-i18n="${key}">${t(key)}</option>`).join('');
      const mappedSort = videoMode && previousSort === 'megapixels-desc'
        ? 'duration-desc'
        : videoMode && previousSort === 'megapixels-asc'
          ? 'duration-asc'
          : !videoMode && previousSort === 'duration-desc'
            ? 'megapixels-desc'
            : !videoMode && previousSort === 'duration-asc'
              ? 'megapixels-asc'
              : previousSort;
      sort.value = [...sort.options].some((option) => option.value === mappedSort) ? mappedSort : 'newest';
      nextState.sort = sort.value;
    }
    return nextState;
  };
  const activeFilterCount = (state = {}, keys = ['query', 'collection', 'origin', 'orientation', 'mediaType', 'minSize', 'mood', 'subject', 'dateFrom', 'dateTo']) => {
    const filterState = normalizeState(state);
    return keys.reduce((count, key) => {
      if (key === 'query') return count + (searchTerms(filterState).length ? 1 : 0);
      if (key === 'dateFrom' || key === 'dateTo') return count + (dateFilterValue(filterState[key]) ? 1 : 0);
      return count + (filterState[key] && filterState[key] !== 'all' ? 1 : 0);
    }, 0);
  };
  const statusNoun = (state = {}, translate = window.photosByElieI18n?.t) => {
    const filterState = normalizeState(state);
    const t = typeof translate === 'function' ? translate : ((key) => key);
    if (filterState.mediaType === 'video') return t('gallery.media_videos');
    if (filterState.mediaType === 'photo') return t('gallery.media_photos');
    return t('gallery.media_items');
  };
  return {
    activeFilterCount,
    captureTime,
    dateFilterValue,
    defaultState: () => ({ ...defaultState }),
    durationSeconds,
    matchesPhoto,
    mediaType,
    photoOrigin,
    matchesSearchTerms,
    normalizeSearchValue,
    searchText,
    searchTerms,
    sortItems,
    statusNoun,
    syncAdaptiveControls,
  };
})();

window.photosByElieCssUrlValue = (url) => `url("${String(url || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[\n\r]/g, "")}")`;

window.photosByElieSeo = (() => {
  const siteOrigin = "https://photos-by-elie.com";
  const siteName = "Photos By Elie";
  const defaultImage = `${siteOrigin}/assets/branding/photosbyelie-camera-tripod-logo-1024.png`;
  const cleanPublicText = (value, fallback = "") => {
    const text = String(value || fallback || "")
      .replace(/\blocalhost\b/gi, "")
      .replace(/\bowner(?:-only)?\b/gi, "")
      .replace(/\bclassification tools?\b/gi, "curated galleries")
      .replace(/\bSaturn Lightroom archive\b/gi, "travel photo archive")
      .replace(/\s+/g, " ")
      .trim();
    return text || fallback || siteName;
  };
  const absoluteUrl = (href = "./") => {
    try {
      const url = new URL(href, siteOrigin);
      if (url.pathname.endsWith("/index.html")) url.pathname = url.pathname.replace(/index\.html$/, "");
      url.searchParams.delete("v");
      return url.toString();
    } catch {
      return siteOrigin + "/";
    }
  };
  const currentPublicUrl = () => absoluteUrl(`${window.location.pathname || "/"}${window.location.search || ""}`);
  const pageUrl = (path, params = {}) => {
    const url = new URL(path || "/", siteOrigin);
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, value);
    });
    return url.toString();
  };
  const setMeta = (selector, attribute, value) => {
    const content = cleanPublicText(value);
    let element = document.head.querySelector(selector);
    if (!element) {
      element = document.createElement("meta");
      const match = selector.match(/meta\[(name|property)="([^"]+)"\]/);
      if (match) element.setAttribute(match[1], match[2]);
      document.head.append(element);
    }
    element.setAttribute(attribute || "content", content);
  };
  const setLink = (rel, href) => {
    let element = document.head.querySelector(`link[rel="${rel}"]`);
    if (!element) {
      element = document.createElement("link");
      element.rel = rel;
      document.head.append(element);
    }
    element.href = absoluteUrl(href);
  };
  const setJsonLd = (id, payload) => {
    if (!payload) return;
    let element = document.getElementById(id);
    if (!element) {
      element = document.createElement("script");
      element.type = "application/ld+json";
      element.id = id;
      document.head.append(element);
    }
    element.textContent = JSON.stringify(payload).replace(/</g, "\\u003c");
  };
  const applyPageMeta = ({
    title = siteName,
    description = "Browse curated travel photography, wall-art edits, and digital photo downloads by Photos By Elie.",
    url = currentPublicUrl(),
    image = defaultImage,
    imageAlt = siteName,
    type = "website",
    jsonLd = null,
  } = {}) => {
    const safeTitle = cleanPublicText(title, siteName);
    const safeDescription = cleanPublicText(description);
    const canonical = absoluteUrl(url);
    const absoluteImage = absoluteUrl(image || defaultImage);
    if (document.title !== safeTitle) document.title = safeTitle;
    setMeta('meta[name="description"]', "content", safeDescription);
    setMeta('meta[property="og:site_name"]', "content", siteName);
    setMeta('meta[property="og:title"]', "content", safeTitle);
    setMeta('meta[property="og:description"]', "content", safeDescription);
    setMeta('meta[property="og:type"]', "content", type);
    setMeta('meta[property="og:url"]', "content", canonical);
    setMeta('meta[property="og:image"]', "content", absoluteImage);
    setMeta('meta[property="og:image:alt"]', "content", imageAlt || safeTitle);
    setMeta('meta[name="twitter:card"]', "content", "summary_large_image");
    setMeta('meta[name="twitter:title"]', "content", safeTitle);
    setMeta('meta[name="twitter:description"]', "content", safeDescription);
    setMeta('meta[name="twitter:image"]', "content", absoluteImage);
    setLink("canonical", canonical);
    if (jsonLd) setJsonLd("photosbyelie-page-jsonld", jsonLd);
  };
  const collectionPageJsonLd = ({ name, description, url, image, photos = [] }) => ({
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: cleanPublicText(name),
    description: cleanPublicText(description),
    url: absoluteUrl(url),
    image: absoluteUrl(image || defaultImage),
    isPartOf: { "@type": "WebSite", name: siteName, url: siteOrigin + "/" },
    mainEntity: {
      "@type": "ImageGallery",
      name: cleanPublicText(name),
      image: photos.slice(0, 12).map((photo) => absoluteUrl(photo.image || photo.url || defaultImage)),
    },
  });
  const imageObjectJsonLd = ({ name, description, url, image, collectionName, keywords = [] }) => ({
    "@context": "https://schema.org",
    "@type": "ImageObject",
    name: cleanPublicText(name),
    description: cleanPublicText(description || `${name} by ${siteName}`),
    url: absoluteUrl(url),
    contentUrl: absoluteUrl(image || defaultImage),
    thumbnailUrl: absoluteUrl(image || defaultImage),
    creator: { "@type": "Person", name: "Elie Cohen" },
    creditText: siteName,
    isPartOf: collectionName ? { "@type": "ImageGallery", name: cleanPublicText(collectionName) } : undefined,
    keywords: keywords.filter(Boolean).slice(0, 24).join(", "),
  });
  return {
    absoluteUrl,
    applyPageMeta,
    cleanPublicText,
    collectionPageJsonLd,
    currentPublicUrl,
    defaultImage,
    imageObjectJsonLd,
    pageUrl,
    siteName,
    siteOrigin,
  };
})();

window.photosByElieMdIcon = (name) => {
  const paths = {
    favorite: 'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z',
    favoriteBorder: 'M16.5 3c-1.74 0-3.41.81-4.5 2.09C10.91 3.81 9.24 3 7.5 3 4.42 3 2 5.42 2 8.5c0 3.78 3.4 6.86 8.55 11.54L12 21.35l1.45-1.32C18.6 15.36 22 12.28 22 8.5 22 5.42 19.58 3 16.5 3zm-4.4 15.55-.1.1-.1-.1C7.14 14.24 4 11.39 4 8.5 4 6.5 5.5 5 7.5 5c1.54 0 3.04.99 3.57 2.36h1.87C13.46 5.99 14.96 5 16.5 5 18.5 5 20 6.5 20 8.5c0 2.89-3.14 5.74-7.9 10.05z',
    play: 'M8 5v14l11-7z',
    shoppingBasket: 'M17.21 9l-4.38-6.56c-.19-.28-.51-.42-.83-.42s-.64.14-.83.43L6.79 9H2c-.55 0-1 .45-1 1 0 .09.01.18.04.27l2.54 9.27C3.81 20.39 4.59 21 5.5 21h13c.91 0 1.69-.61 1.93-1.46l2.54-9.27L23 10c0-.55-.45-1-1-1h-4.79zM9 9l3-4.4L15 9H9zm3 8c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z',
    photoCamera: 'M20 5h-3.17l-1.84-2H9.01L7.17 5H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm-8 13c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-1.8c1.77 0 3.2-1.43 3.2-3.2S13.77 9.8 12 9.8 8.8 11.23 8.8 13s1.43 3.2 3.2 3.2z',
    autoAwesome: 'M19 9l1.25-2.75L23 5l-2.75-1.25L19 1l-1.25 2.75L15 5l2.75 1.25L19 9zm-7.5.5L9 4 6.5 9.5 1 12l5.5 2.5L9 20l2.5-5.5L17 12l-5.5-2.5zM19 15l-1.25 2.75L15 19l2.75 1.25L19 23l1.25-2.75L23 19l-2.75-1.25L19 15z',
    accountCircle: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08s5.97 1.09 6 3.08c-1.29 1.94-3.5 3.22-6 3.22z',
    settings: 'M19.43 12.98c.04-.32.07-.65.07-.98s-.02-.66-.07-.98l2.11-1.65c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.37-.31-.6-.22l-2.49 1c-.52-.4-1.08-.73-1.69-.98L14.5 2.42C14.47 2.18 14.25 2 14 2h-4c-.25 0-.46.18-.5.42L9.12 5.07c-.61.25-1.18.59-1.69.98l-2.49-1c-.23-.08-.48 0-.6.22l-2 3.46c-.13.22-.07.49.12.64l2.11 1.65c-.04.32-.08.65-.08.98s.03.66.08.98l-2.11 1.65c-.19.15-.24.42-.12.64l2 3.46c.12.22.37.31.6.22l2.49-1c.52.4 1.08.73 1.69.98l.38 2.65c.04.24.25.42.5.42h4c.25 0 .47-.18.5-.42l.38-2.65c.61-.25 1.18-.58 1.69-.98l2.49 1c.23.08.48 0 .6-.22l2-3.46c.12-.22.07-.49-.12-.64l-2.11-1.65zM12 15.5c-1.93 0-3.5-1.57-3.5-3.5s1.57-3.5 3.5-3.5 3.5 1.57 3.5 3.5-1.57 3.5-3.5 3.5z',
    visibility: 'M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zm0 12.5c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z',
    visibilityOff: 'M12 6.5c3.79 0 7.17 2.13 8.82 5.5-.7 1.43-1.79 2.62-3.08 3.49L19.16 16.91C20.69 15.88 22 14.2 23 12c-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l1.65 1.65c.74-.23 1.52-.35 2.33-.35zM2.1 3.27.82 4.55l3.01 3.01C2.67 8.68 1.7 10.19 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l3.07 3.07 1.27-1.27L2.1 3.27zm7.53 7.53 1.55 1.55c-.11-.39-.02-.82.29-1.13.31-.31.74-.4 1.13-.29l-1.55-1.55c.31-.08.63-.12.95-.12 1.66 0 3 1.34 3 3 0 .32-.04.64-.12.95l1.54 1.54c.37-.68.58-1.45.58-2.29 0-2.76-2.24-5-5-5-.84 0-1.61.21-2.29.58zm2.37 6.2c-2.76 0-5-2.24-5-5 0-.84.21-1.61.58-2.29l1.54 1.54c-.08.31-.12.63-.12.95 0 1.66 1.34 3 3 3 .32 0 .64-.04.95-.12l1.54 1.54c-.68.37-1.45.58-2.29.58z'
  };
  const path = paths[name] || paths.favoriteBorder;
  return `<svg class="md-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${path}"></path></svg>`;
};

window.photosByEliePositionGalleryViewControls = (viewControls) => {
  if (!viewControls) return;
  const topbar = document.querySelector('.topbar');
  const headerControls = document.querySelector('.header-controls');
  const brand = document.querySelector('.brand');
  const topbarRect = topbar?.getBoundingClientRect();
  const headerRect = headerControls?.getBoundingClientRect();
  const brandRect = brand?.getBoundingClientRect();
  const controlsWidth = viewControls.getBoundingClientRect().width || 0;
  const gutter = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--page-gutter')) || 18;
  let topOffset = topbarRect ? Math.max(12, Math.ceil(topbarRect.top + 10)) : 12;
  let rightOffset = Math.max(gutter, (window.innerWidth - 1480) / 2 + 92);
  if (topbarRect && headerRect && controlsWidth) {
    const headerBandRight = Math.max(gutter, window.innerWidth - headerRect.left + 8);
    const headerBandLeft = window.innerWidth - headerBandRight - controlsWidth;
    const clearLeft = Math.max(topbarRect.left, brandRect?.right || topbarRect.left) + 12;
    if (headerBandLeft > clearLeft) {
      rightOffset = headerBandRight;
    } else {
      topOffset = Math.ceil(topbarRect.bottom + 8);
      rightOffset = gutter;
    }
  }
  viewControls.style.setProperty('--gallery-view-controls-top', `${topOffset}px`);
  viewControls.style.setProperty('--gallery-view-controls-right', `${rightOffset}px`);
};

const ensureHeaderActionLinks = () => {
  const controls = document.querySelector('.header-controls');
  if (!controls || controls.querySelector('[data-header-actions]')) return;
  const showBuyAction = document.body?.classList.contains('commerce-page');
  const buyHref = window.location.pathname.endsWith('/basket.html') || window.location.pathname.endsWith('basket.html')
    ? '#checkout'
    : './basket.html#checkout';
  const actions = document.createElement('nav');
  actions.className = 'header-action-links';
  actions.dataset.headerActions = '';
  actions.setAttribute('aria-label', translate('a11y.photo_navigation'));
  actions.innerHTML = `
    <a class="header-action-link" href="./liked.html" data-i18n-aria-label="a11y.open_liked" data-i18n-title="a11y.open_liked">
      ${window.photosByElieMdIcon('favorite')}
    </a>
    <a class="header-action-link" href="./basket.html" data-i18n-aria-label="a11y.open_basket" data-i18n-title="a11y.open_basket">
      ${window.photosByElieMdIcon('shoppingBasket')}
    </a>
    ${showBuyAction ? `
      <a class="header-action-link header-buy-link" href="${buyHref}" aria-label="Checkout" title="Checkout">
        <span aria-hidden="true">$</span>
      </a>
    ` : ''}
  `;
  controls.prepend(actions);
};

const headerUtilityControls = (topbar) => {
  let utilities = topbar?.querySelector('.header-utility-controls');
  if (!topbar) return null;
  if (!utilities) {
    utilities = document.createElement('div');
    utilities.className = 'header-utility-controls';
    topbar.append(utilities);
  }
  return utilities;
};

const accountPreferenceKey = 'photosbyelie-account-preference';

const normalizedAccountWorkerBase = (value) => {
  const raw = String(value || "").trim().replace(/\/+$/, "");
  if (!raw) return "";
  try {
    const url = new URL(raw, window.location.href);
    return /^https?:$/.test(url.protocol) ? url.href.replace(/\/+$/, "") : "";
  } catch {
    return "";
  }
};

const accountWorkerBaseUrl = () => {
  const params = new URLSearchParams(window.location.search);
  const override = normalizedAccountWorkerBase(params.get("authWorkerBase") || params.get("workerBase"));
  if (override) return override;
  const mediaConfig = window.photosByElieMediaConfig || {};
  const configured = normalizedAccountWorkerBase(mediaConfig.authWorkerBaseUrl || mediaConfig.checkoutWorkerBaseUrl || "");
  return configured;
};

const accountReturnUrl = () => {
  const url = new URL(window.location.href);
  url.searchParams.set("account", "1");
  return url.href;
};

const consumeAccountReturnFlag = () => {
  const url = new URL(window.location.href);
  if (url.searchParams.get("account") !== "1") return false;
  if (/\/order\.html$/i.test(url.pathname)) return true;
  url.searchParams.delete("account");
  window.history.replaceState(window.history.state, document.title, url.href);
  return true;
};

const ensureSiteAccount = () => {
  const controls = document.querySelector('.header-controls');
  const topbar = controls?.closest('.topbar');
  if (!controls || !topbar || topbar.querySelector('[data-account-toggle]')) return;
  const state = {
    checked: false,
    available: Boolean(accountWorkerBaseUrl()),
    authenticated: false,
    email: "",
    tier: "user",
    profileLoading: false,
    profileLoaded: false,
    profile: { liked: [], basket: [] },
    orders: [],
  };
  let accountProfileWriteTimer = null;
  let applyingAccountProfile = false;
  const escapeAccountHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  }[char]));

  const accountButton = document.createElement('button');
  accountButton.className = 'account-toggle';
  accountButton.type = 'button';
  accountButton.dataset.accountToggle = '';
  accountButton.setAttribute('aria-haspopup', 'dialog');
  accountButton.setAttribute('aria-expanded', 'false');
  accountButton.dataset.i18nAriaLabel = 'account.open';
  accountButton.dataset.i18nTitle = 'account.open';
  accountButton.innerHTML = window.photosByElieMdIcon('accountCircle');

  const modal = document.createElement('div');
  modal.className = 'site-account-modal';
  modal.hidden = true;
  modal.dataset.accountModal = '';
  modal.innerHTML = `
    <section class="site-account-dialog" role="dialog" aria-modal="true" aria-labelledby="site-account-title">
      <div class="site-settings-head site-account-head">
        <h2 id="site-account-title" data-i18n="account.title">${translate('account.title')}</h2>
        <button class="site-settings-close" type="button" data-account-close data-i18n-aria-label="account.close" data-i18n-title="account.close" aria-label="${translate('account.close')}" title="${translate('account.close')}">x</button>
      </div>
      <div class="site-account-status">
        <div class="site-account-status-row">
          <div>
            <strong data-account-status-title>${translate('account.visitor_status')}</strong>
            <span data-account-status-detail>${translate('account.choose')}</span>
          </div>
          <button class="site-account-mini-action site-account-signout-inline" type="button" data-account-signout-inline data-i18n="account.sign_out" hidden>${translate('account.sign_out')}</button>
        </div>
      </div>
      <div class="site-account-memory" data-account-memory hidden>
        <div>
          <p class="site-account-section-title" data-i18n="account.memory_title">${translate('account.memory_title')}</p>
          <strong data-account-memory-counts>${translate('account.memory_counts', { likes: 0, basket: 0, orders: 0 })}</strong>
          <span data-i18n="account.memory_body">${translate('account.memory_body')}</span>
        </div>
        <div class="site-account-memory-actions">
          <a class="site-account-mini-action" href="./liked.html" data-i18n="account.open_liked">${translate('account.open_liked')}</a>
          <a class="site-account-mini-action" href="./basket.html" data-i18n="account.open_basket">${translate('account.open_basket')}</a>
          <button class="site-account-mini-action" type="button" data-account-sync data-i18n-title="account.sync_help" title="${translate('account.sync_help')}">${translate('account.sync_now')}</button>
        </div>
      </div>
      <div class="site-account-orders" data-account-orders hidden>
        <p class="site-account-section-title" data-i18n="account.orders_title">${translate('account.orders_title')}</p>
        <p class="site-account-empty" data-account-orders-empty>${translate('account.no_orders')}</p>
        <ol data-account-orders-list></ol>
      </div>
      <div class="site-account-actions">
        <button class="site-account-action" type="button" data-account-visitor data-i18n="account.continue_visitor">${translate('account.continue_visitor')}</button>
        <button class="site-account-action" type="button" data-account-signout data-i18n="account.sign_out" hidden>${translate('account.sign_out')}</button>
        <button class="site-account-action primary" type="button" data-account-signup data-i18n="account.sign_up_google">${translate('account.sign_up_google')}</button>
        <button class="site-account-action" type="button" data-account-signin data-i18n="account.sign_in_google">${translate('account.sign_in_google')}</button>
      </div>
      <p class="site-account-message" data-account-message aria-live="polite"></p>
    </section>
  `;

  const closeButton = modal.querySelector('[data-account-close]');
  const visitorButton = modal.querySelector('[data-account-visitor]');
  const signoutButton = modal.querySelector('[data-account-signout]');
  const signoutInlineButton = modal.querySelector('[data-account-signout-inline]');
  const signupButton = modal.querySelector('[data-account-signup]');
  const signinButton = modal.querySelector('[data-account-signin]');
  const statusTitle = modal.querySelector('[data-account-status-title]');
  const statusDetail = modal.querySelector('[data-account-status-detail]');
  const message = modal.querySelector('[data-account-message]');
  const memoryPanel = modal.querySelector('[data-account-memory]');
  const memoryCounts = modal.querySelector('[data-account-memory-counts]');
  const syncButton = modal.querySelector('[data-account-sync]');
  const ordersPanel = modal.querySelector('[data-account-orders]');
  const ordersEmpty = modal.querySelector('[data-account-orders-empty]');
  const ordersList = modal.querySelector('[data-account-orders-list]');

  const setMessage = (text = "", isError = false) => {
    if (!message) return;
    message.textContent = text;
    message.classList.toggle("is-error", isError);
  };

  const accountStoresAvailable = () => Boolean(
    window.photosByElieLiked?.read
    && window.photosByElieLiked?.write
    && window.photosByElieBasket?.read
    && window.photosByElieBasket?.write
  );

  const waitForAccountCatalog = async () => {
    try {
      await window.photosByElieCatalogReady;
    } catch {
      // Profile sync can still list orders on pages without a catalog.
    }
  };

  const readLocalAccountState = () => ({
    liked: accountStoresAvailable() ? window.photosByElieLiked.read() : [],
    basket: accountStoresAvailable() ? window.photosByElieBasket.read() : [],
  });

  const mergeLikedItems = (...groups) => {
    const byPhoto = new Map();
    groups.flat().forEach((item) => {
      const photoId = String(typeof item === "string" ? item : item?.photoId || "").trim();
      if (!photoId || byPhoto.has(photoId)) return;
      byPhoto.set(photoId, typeof item === "string" ? { photoId } : item);
    });
    return [...byPhoto.values()];
  };

  const optionKey = (option) => String(typeof option === "string" ? option : option?.id || "").trim();

  const mergeBasketItems = (...groups) => {
    const byPhoto = new Map();
    groups.flat().forEach((item) => {
      const photoId = String(item?.photoId || "").trim();
      if (!photoId) return;
      const existing = byPhoto.get(photoId) || { ...item, photoId, options: [] };
      const options = new Map((existing.options || []).map((option) => [optionKey(option), option]).filter(([key]) => key));
      (item.options || []).forEach((option) => {
        const keyName = optionKey(option);
        if (keyName) options.set(keyName, option);
      });
      byPhoto.set(photoId, { ...existing, ...item, options: [...options.values()] });
    });
    return [...byPhoto.values()];
  };

  const orderHrefFor = (order) => {
    const url = new URL("./order.html", window.location.href);
    url.searchParams.set("id", order.id);
    url.searchParams.set("account", "1");
    return url.href;
  };

  const accountOrderDate = (order) => {
    const date = new Date(order.paidAt || order.createdAt || order.updatedAt || "");
    if (!Number.isFinite(date.getTime())) return "";
    return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(date);
  };

  const accountOrderItemsSummary = (order) => {
    const items = (order.items || []).map((item) => String(item.title || item.photoId || "").trim()).filter(Boolean);
    if (!items.length) return "";
    const visible = items.slice(0, 3).join(" · ");
    return items.length > 3 ? `${visible} · +${items.length - 3}` : visible;
  };

  const resendAccountOrderInstructions = async (orderId, button) => {
    const order = (state.orders || []).find((candidate) => candidate.id === orderId);
    if (!order?.id || !order?.buyerEmail || order.status !== "ready") return;
    const workerBase = accountWorkerBaseUrl();
    if (!workerBase) return;
    button?.setAttribute("disabled", "");
    setMessage(translate('account.order_resending'));
    try {
      const response = await fetch(`${workerBase}/orders/${encodeURIComponent(order.id)}/resend-email`, {
        method: "POST",
        cache: "no-store",
        credentials: "omit",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: order.buyerEmail }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error?.message || `HTTP ${response.status}`);
      if (payload.order) {
        state.orders = state.orders.map((candidate) => candidate.id === payload.order.id ? payload.order : candidate);
      }
      setMessage(translate('account.order_resent', { email: order.buyerEmail }));
      renderAccountOrders();
    } catch (error) {
      setMessage(translate('account.order_resend_failed', { message: error?.message || "unknown" }), true);
    } finally {
      button?.removeAttribute("disabled");
    }
  };

  const renderAccountOrders = () => {
    const orders = Array.isArray(state.orders) ? state.orders : [];
    if (ordersPanel) ordersPanel.hidden = !state.authenticated;
    if (ordersEmpty) ordersEmpty.hidden = orders.length > 0;
    if (!ordersList) return;
    ordersList.innerHTML = orders.map((order) => {
      const ready = order.status === "ready";
      const itemCount = (order.items || []).length;
      const fileCount = (order.delivery?.files || []).length || (order.delivery?.downloadUrl ? 1 : 0);
      const itemsSummary = accountOrderItemsSummary(order);
      return `
        <li>
          <div>
            <strong>${escapeAccountHtml(order.id)}</strong>
            <span>${escapeAccountHtml(accountOrderDate(order))}${itemCount ? ` · ${itemCount} photo${itemCount === 1 ? "" : "s"}` : ""}${fileCount ? ` · ${fileCount} file${fileCount === 1 ? "" : "s"}` : ""}</span>
            ${itemsSummary ? `<span class="site-account-order-products">${escapeAccountHtml(itemsSummary)}</span>` : ""}
            <span>${escapeAccountHtml(translate(ready ? 'account.order_ready' : 'account.order_pending'))}</span>
          </div>
          <div class="site-account-order-actions">
            <a class="site-account-mini-action" href="${escapeAccountHtml(orderHrefFor(order))}">${escapeAccountHtml(translate('account.view_downloads'))}</a>
            <button class="site-account-mini-action" type="button" data-account-resend-order="${escapeAccountHtml(order.id)}"${ready ? "" : " disabled"} title="${escapeAccountHtml(translate(ready ? 'account.resend_downloads' : 'account.resend_unavailable'))}">${escapeAccountHtml(translate('account.resend_downloads'))}</button>
          </div>
        </li>
      `;
    }).join("");
  };

  const renderAccountMemory = () => {
    if (memoryPanel) memoryPanel.hidden = !state.authenticated;
    const local = readLocalAccountState();
    const likedCount = accountStoresAvailable() ? local.liked.length : state.profile?.liked?.length || 0;
    const basketCount = accountStoresAvailable() ? local.basket.length : state.profile?.basket?.length || 0;
    const orderCount = Array.isArray(state.orders) ? state.orders.length : 0;
    if (memoryCounts) {
      memoryCounts.textContent = translate('account.memory_counts', {
        likes: likedCount,
        basket: basketCount,
        orders: orderCount,
      });
    }
    if (syncButton) syncButton.disabled = !state.authenticated || state.profileLoading;
    renderAccountOrders();
  };

  const accountApiFetch = async (path, options = {}) => {
    const workerBase = accountWorkerBaseUrl();
    if (!workerBase) throw new Error(translate('account.login_unavailable'));
    const response = await fetch(`${workerBase}${path}`, {
      cache: "no-store",
      credentials: "include",
      ...options,
      headers: {
        ...(options.body ? { "content-type": "application/json" } : {}),
        ...(options.headers || {}),
      },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.ok === false) {
      throw new Error(payload?.error?.message || payload?.error || `HTTP ${response.status}`);
    }
    return payload;
  };

  const applyAccountProfileToStores = (profile) => {
    if (!accountStoresAvailable() || !profile) return;
    applyingAccountProfile = true;
    try {
      window.photosByElieLiked.write(profile.liked || []);
      window.photosByElieBasket.write(profile.basket || []);
    } finally {
      applyingAccountProfile = false;
    }
  };

  const saveAccountProfile = async ({ quiet = false } = {}) => {
    if (!state.authenticated || !accountStoresAvailable()) return null;
    state.profileLoading = true;
    renderAccountMemory();
    if (!quiet) setMessage(translate('account.profile_syncing'));
    try {
      await waitForAccountCatalog();
      const local = readLocalAccountState();
      const payload = await accountApiFetch("/account/profile", {
        method: "PUT",
        body: JSON.stringify(local),
      });
      state.profile = payload.profile || local;
      state.orders = Array.isArray(payload.orders) ? payload.orders : state.orders;
      state.profileLoaded = true;
      if (!quiet) setMessage(translate('account.profile_saved'));
      return payload;
    } catch (error) {
      if (!quiet) setMessage(error?.message || translate('account.profile_failed'), true);
      return null;
    } finally {
      state.profileLoading = false;
      renderAccountMemory();
    }
  };

  const loadAccountProfile = async ({ mergeLocal = false, quiet = false } = {}) => {
    if (!state.authenticated) return null;
    state.profileLoading = true;
    renderAccountMemory();
    if (!quiet) setMessage(translate('account.profile_syncing'));
    try {
      let payload = await accountApiFetch("/account/profile");
      let profile = payload.profile || { liked: [], basket: [] };
      if (mergeLocal && accountStoresAvailable()) {
        await waitForAccountCatalog();
        const local = readLocalAccountState();
        const merged = {
          liked: mergeLikedItems(profile.liked || [], local.liked || []),
          basket: mergeBasketItems(profile.basket || [], local.basket || []),
        };
        payload = await accountApiFetch("/account/profile", {
          method: "PUT",
          body: JSON.stringify(merged),
        });
        profile = payload.profile || merged;
      }
      state.profile = profile;
      state.orders = Array.isArray(payload.orders) ? payload.orders : [];
      state.profileLoaded = true;
      if (accountStoresAvailable()) await waitForAccountCatalog();
      applyAccountProfileToStores(profile);
      if (!quiet) setMessage(translate('account.profile_loaded'));
      return payload;
    } catch (error) {
      if (!quiet) setMessage(error?.message || translate('account.profile_failed'), true);
      return null;
    } finally {
      state.profileLoading = false;
      renderAccountMemory();
    }
  };

  const scheduleAccountProfileSave = () => {
    if (applyingAccountProfile || !state.authenticated || !accountStoresAvailable()) return;
    window.clearTimeout(accountProfileWriteTimer);
    accountProfileWriteTimer = window.setTimeout(() => {
      saveAccountProfile({ quiet: true });
    }, 900);
    renderAccountMemory();
  };

  const updateAccountView = () => {
    const workerBase = accountWorkerBaseUrl();
    state.available = Boolean(workerBase);
    accountButton.classList.toggle("is-authenticated", state.authenticated);
    if (state.authenticated) {
      if (statusTitle) statusTitle.textContent = translate('account.signed_in');
      if (statusDetail) statusDetail.textContent = state.email || translate('account.verified_email');
      if (visitorButton) {
        visitorButton.dataset.i18n = 'account.continue_browsing';
        visitorButton.textContent = translate('account.continue_browsing');
      }
      if (signoutButton) signoutButton.hidden = false;
      if (signoutInlineButton) signoutInlineButton.hidden = false;
      if (signupButton) signupButton.hidden = true;
      if (signinButton) signinButton.hidden = true;
      if (!state.profileLoaded && !state.profileLoading) setMessage(translate('account.verified_email'));
      renderAccountMemory();
      return;
    }
    if (statusTitle) statusTitle.textContent = translate('account.visitor_status');
    if (statusDetail) statusDetail.textContent = translate('account.choose');
    if (visitorButton) {
      visitorButton.dataset.i18n = 'account.continue_visitor';
      visitorButton.textContent = translate('account.continue_visitor');
    }
    if (signupButton) signupButton.hidden = false;
    if (signinButton) signinButton.hidden = false;
    if (signoutButton) signoutButton.hidden = true;
    if (signoutInlineButton) signoutInlineButton.hidden = true;
    if (signupButton) signupButton.disabled = !state.available;
    if (signinButton) signinButton.disabled = !state.available;
    setMessage(state.available ? "" : translate('account.login_unavailable'), !state.available);
    renderAccountMemory();
  };

  const refreshAccountSession = async ({ syncProfile = false, mergeLocal = false, quiet = false } = {}) => {
    const workerBase = accountWorkerBaseUrl();
    state.available = Boolean(workerBase);
    if (!workerBase) {
      state.checked = true;
      state.authenticated = false;
      state.email = "";
      state.tier = "user";
      state.profileLoaded = false;
      state.profile = { liked: [], basket: [] };
      state.orders = [];
      updateAccountView();
      return { ...state };
    }
    if (!quiet) setMessage(translate('account.loading'));
    try {
      const response = await fetch(`${workerBase}/auth/session`, { cache: "no-store", credentials: "include" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.ok === false) {
        throw new Error(payload?.error?.message || payload?.error || "Session check failed.");
      }
      const user = payload.user || {};
      state.checked = true;
      state.available = true;
      state.authenticated = payload.authenticated === true;
      state.email = user.email || payload.email || "";
      state.tier = payload.tier || user.tier || "user";
      if (!state.authenticated) {
        state.profileLoaded = false;
        state.profile = { liked: [], basket: [] };
        state.orders = [];
      }
      updateAccountView();
      if (state.authenticated && syncProfile) {
        await loadAccountProfile({ mergeLocal, quiet });
      }
    } catch {
      state.checked = true;
      state.available = false;
      state.authenticated = false;
      state.email = "";
      state.tier = "user";
      state.profileLoaded = false;
      state.profile = { liked: [], basket: [] };
      state.orders = [];
      updateAccountView();
      if (!quiet) setMessage(translate('account.session_failed'), true);
    }
    return { ...state };
  };

  const closeAccount = () => {
    if (modal.hidden) return;
    modal.hidden = true;
    accountButton.setAttribute('aria-expanded', 'false');
    accountButton.focus({ preventScroll: true });
  };

  const openAccount = () => {
    modal.hidden = false;
    accountButton.setAttribute('aria-expanded', 'true');
    updateAccountView();
    closeButton?.focus({ preventScroll: true });
    refreshAccountSession({ syncProfile: true, mergeLocal: true });
  };

  const beginGoogleLogin = (intent) => {
    const workerBase = accountWorkerBaseUrl();
    if (!workerBase) {
      state.available = false;
      updateAccountView();
      return;
    }
    localStorage.setItem(accountPreferenceKey, intent);
    const loginUrl = new URL(`${workerBase}/auth/google/login`);
    loginUrl.searchParams.set("returnTo", accountReturnUrl());
    loginUrl.searchParams.set("intent", intent);
    loginUrl.searchParams.set("prompt", "select_account");
    setMessage(translate('account.redirecting'));
    window.location.href = loginUrl.href;
  };

  const beginGoogleLogout = () => {
    const workerBase = accountWorkerBaseUrl();
    localStorage.setItem(accountPreferenceKey, 'visitor');
    setMessage(translate('account.signing_out'));
    if (!workerBase) {
      state.authenticated = false;
      state.email = "";
      state.tier = "user";
      updateAccountView();
      return;
    }
    const logoutUrl = new URL(`${workerBase}/auth/logout`);
    logoutUrl.searchParams.set("returnTo", accountReturnUrl());
    window.location.href = logoutUrl.href;
  };

  document.body.append(modal);
  headerUtilityControls(topbar)?.append(accountButton);

  accountButton.addEventListener('click', () => {
    if (modal.hidden) openAccount();
    else closeAccount();
  });
  closeButton?.addEventListener('click', closeAccount);
  visitorButton?.addEventListener('click', () => {
    localStorage.setItem(accountPreferenceKey, 'visitor');
    closeAccount();
  });
  signupButton?.addEventListener('click', () => beginGoogleLogin('signup'));
  signinButton?.addEventListener('click', () => beginGoogleLogin('signin'));
  signoutButton?.addEventListener('click', beginGoogleLogout);
  signoutInlineButton?.addEventListener('click', beginGoogleLogout);
  syncButton?.addEventListener('click', () => saveAccountProfile());
  ordersList?.addEventListener('click', async (event) => {
    const resendButton = event.target.closest('[data-account-resend-order]');
    if (!resendButton) return;
    await resendAccountOrderInstructions(resendButton.dataset.accountResendOrder, resendButton);
  });
  modal.addEventListener('click', (event) => {
    if (event.target === modal) closeAccount();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !modal.hidden) closeAccount();
  });
  window.addEventListener('photosbyelie:languagechange', () => updateAccountView());
  window.addEventListener('photosbyelie:likedchange', scheduleAccountProfileSave);
  window.addEventListener('photosbyelie:basketchange', scheduleAccountProfileSave);
  window.photosByElieAccount = {
    get state() {
      return {
        checked: state.checked,
        available: state.available,
        authenticated: state.authenticated,
        email: state.email,
        tier: state.tier,
        profileLoaded: state.profileLoaded,
        profile: state.profile,
        orders: state.orders,
      };
    },
    refresh: refreshAccountSession,
    sync: saveAccountProfile,
    workerBaseUrl: accountWorkerBaseUrl,
  };
  updateAccountView();
  applyTranslations();
  if (consumeAccountReturnFlag()) window.setTimeout(openAccount, 0);
  else if (accountWorkerBaseUrl() && localStorage.getItem(accountPreferenceKey) !== 'visitor') {
    window.setTimeout(() => {
      refreshAccountSession({ syncProfile: true, mergeLocal: true, quiet: true });
    }, 900);
  }
};

const ensureSiteSettings = () => {
  const controls = document.querySelector('.header-controls');
  const topbar = controls?.closest('.topbar');
  if (!controls || !topbar || topbar.querySelector('[data-settings-toggle]')) return;
  const settings = readDisplaySettings();
  const settingsButton = document.createElement('button');
  settingsButton.className = 'settings-toggle';
  settingsButton.type = 'button';
  settingsButton.dataset.settingsToggle = '';
  settingsButton.setAttribute('aria-haspopup', 'dialog');
  settingsButton.setAttribute('aria-expanded', 'false');
  settingsButton.dataset.i18nAriaLabel = 'settings.open';
  settingsButton.dataset.i18nTitle = 'settings.open';
  settingsButton.innerHTML = window.photosByElieMdIcon('settings');

  const modal = document.createElement('div');
  modal.className = 'site-settings-modal';
  modal.hidden = true;
  modal.dataset.settingsModal = '';
  modal.innerHTML = `
    <section class="site-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="site-settings-title">
      <div class="site-settings-head">
        <h2 id="site-settings-title" data-i18n="settings.title">${translate('settings.title')}</h2>
        <button class="site-settings-close" type="button" data-settings-close data-i18n-aria-label="settings.close" data-i18n-title="settings.close" aria-label="${translate('settings.close')}" title="${translate('settings.close')}">x</button>
      </div>
      <div class="site-settings-section">
        <p class="site-settings-section-title" data-i18n="settings.language">${translate('settings.language')}</p>
        <div class="site-settings-slot" data-settings-language-slot></div>
      </div>
      <div class="site-settings-section">
        <p class="site-settings-section-title" data-i18n="settings.appearance">${translate('settings.appearance')}</p>
        <div class="site-settings-slot" data-settings-theme-slot></div>
      </div>
      <label class="site-settings-slider">
        <span class="site-settings-slider-label">
          <span class="site-settings-label-text" data-i18n="settings.transparency">${translate('settings.transparency')}</span>
          <output class="site-settings-value" data-display-setting-output="transparency">${settings.transparency}%</output>
        </span>
        <input type="range" min="0" max="100" step="1" value="${settings.transparency}" data-display-setting="transparency">
        <span class="site-settings-range-labels"><span data-i18n="settings.solid">${translate('settings.solid')}</span><span data-i18n="settings.clear">${translate('settings.clear')}</span></span>
      </label>
      <label class="site-settings-slider">
        <span class="site-settings-slider-label">
          <span class="site-settings-label-text" data-i18n="settings.translucency">${translate('settings.translucency')}</span>
          <output class="site-settings-value" data-display-setting-output="translucency">${settings.translucency}%</output>
        </span>
        <input type="range" min="0" max="100" step="1" value="${settings.translucency}" data-display-setting="translucency">
        <span class="site-settings-range-labels"><span data-i18n="settings.sharp">${translate('settings.sharp')}</span><span data-i18n="settings.frosted">${translate('settings.frosted')}</span></span>
      </label>
    </section>
  `;
  const languageSlot = modal.querySelector('[data-settings-language-slot]');
  const themeSlot = modal.querySelector('[data-settings-theme-slot]');
  if (languageBtn && languageSlot) languageSlot.append(languageBtn);
  if (btn && themeSlot) themeSlot.append(btn);
  document.body.append(modal);
  headerUtilityControls(topbar)?.append(settingsButton);

  const closeButton = modal.querySelector('[data-settings-close]');
  const closeSettings = () => {
    if (modal.hidden) return;
    modal.hidden = true;
    settingsButton.setAttribute('aria-expanded', 'false');
    settingsButton.focus({ preventScroll: true });
  };
  const openSettings = () => {
    modal.hidden = false;
    settingsButton.setAttribute('aria-expanded', 'true');
    updateDisplaySettingOutputs(readDisplaySettings());
    closeButton?.focus({ preventScroll: true });
  };
  settingsButton.addEventListener('click', () => {
    if (modal.hidden) openSettings();
    else closeSettings();
  });
  closeButton?.addEventListener('click', closeSettings);
  modal.addEventListener('click', (event) => {
    if (event.target === modal) closeSettings();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !modal.hidden) closeSettings();
  });
  modal.querySelectorAll('[data-display-setting]').forEach((input) => {
    input.addEventListener('input', () => {
      const current = readDisplaySettings();
      const next = saveDisplaySettings({
        ...current,
        [input.dataset.displaySetting]: input.value,
      });
      applyDisplaySettings(next);
      updateDisplaySettingOutputs(next);
    });
  });
  applyTranslations();
};

ensureHeaderActionLinks();
ensureSiteAccount();
ensureSiteSettings();

const syncFixedHeaderOffset = () => {
  if (!document.body?.matches?.("[data-gallery], [data-fixed-header]")) return;
  const topbar = document.querySelector(".topbar");
  if (!topbar) return;
  document.documentElement.style.setProperty("--fixed-header-offset", `${Math.ceil(topbar.offsetHeight + 8)}px`);
};

if (document.body?.matches?.("[data-gallery], [data-fixed-header]")) {
  const topbar = document.querySelector(".topbar");
  syncFixedHeaderOffset();
  window.addEventListener("resize", syncFixedHeaderOffset);
  window.addEventListener("photosbyelie:languagechange", syncFixedHeaderOffset);
  document.fonts?.ready?.then(syncFixedHeaderOffset).catch(() => {});
  if (topbar && "ResizeObserver" in window) {
    new ResizeObserver(syncFixedHeaderOffset).observe(topbar);
  }
}

document.querySelectorAll("[data-header-back-to-top]").forEach((button) => {
  button.addEventListener("click", () => {
    const prefersReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    window.scrollTo({ top: 0, behavior: prefersReducedMotion ? "auto" : "smooth" });
  });
});

btn?.addEventListener('click', () => {
  root.dataset.theme = root.dataset.theme === 'light' ? 'dark' : 'light';
  localStorage.setItem(key, root.dataset.theme);
  applyDisplaySettings();
  applyTranslations();
});

const setLanguage = (language) => {
  const next = languages.find((item) => item.code === language) || languages[0];
  root.dataset.language = next.code;
  root.lang = next.code;
  if (languageBtn) languageBtn.textContent = next.label;
  localStorage.setItem(languageKey, next.code);
  applyTranslations();
  window.dispatchEvent(new CustomEvent('photosbyelie:languagechange', {
    detail: { language: next.code }
  }));
};

const beepUnavailableLanguage = () => {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'square';
    oscillator.frequency.value = 440;
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.08, context.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.16);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.18);
    oscillator.addEventListener('ended', () => context.close(), { once: true });
  } catch {
    // Some browsers block Web Audio even inside a click; staying English is the important behavior.
  }
};

if (languageBtn) {
  const ownerEnglishOnly = languageBtn.hasAttribute('data-owner-english-only');
  const savedLanguage = ownerEnglishOnly ? 'en' : localStorage.getItem(languageKey);
  setLanguage(savedLanguage);
  languageBtn.addEventListener('click', () => {
    if (ownerEnglishOnly) {
      setLanguage('en');
      beepUnavailableLanguage();
      return;
    }
    const currentIndex = languages.findIndex((item) => item.code === root.dataset.language);
    const nextLanguage = languages[(currentIndex + 1) % languages.length];
    setLanguage(nextLanguage.code);
  });
} else {
  setLanguage(localStorage.getItem(languageKey));
}
