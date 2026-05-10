const root = document.documentElement;
const key = 'byelie-theme';
const btn = document.querySelector('[data-theme-toggle]');
const languageKey = 'byelie-language';
const languageBtn = document.querySelector('[data-language-toggle]');
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
    'theme.night': 'Night',
    'theme.day': 'Day',
    'home.lead': 'A selected photo archive with country galleries, AI work kept separate, and fresh representative samples as the collection rail turns.',
    'home.view_collections': 'View collections',
    'home.collections': 'Collections',
    'home.archive_shape': 'Archive shape',
    'home.metric_owner': 'Owner',
    'home.metric_owner_label': 'Reviews and publishes the catalog',
    'home.metric_groups': 'Public collection groups',
    'home.metric_fresh': 'Fresh',
    'home.metric_fresh_label': 'Rotating samples as collections turn',
    'collection.france': 'France',
    'collection.usa': 'USA',
    'collection.spain': 'Spain',
    'collection.mexico': 'Mexico',
    'collection.ai': 'AI',
    'collection.portugal': 'Portugal',
    'collection.slovakia': 'Slovakia',
    'common.back_to_collections': 'Back to collections',
    'common.back_to_gallery': 'Back to gallery',
    'common.previous': 'Previous',
    'common.next': 'Next',
    'common.refresh': 'Refresh',
    'common.photo': 'Photo',
    'common.photo_detail': 'Photo detail',
    'gallery.grid': 'Grid',
    'gallery.fit': 'Fit',
    'gallery.fill': 'Fill',
    'gallery.orientation': 'Orientation',
    'gallery.color_mood': 'Color mood',
    'gallery.subject': 'Subject',
    'gallery.sort': 'Sort',
    'gallery.all': 'All',
    'gallery.landscape': 'Landscape',
    'gallery.portrait': 'Portrait',
    'gallery.square': 'Square',
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
    'gallery.highest_price': 'Highest price',
    'gallery.lowest_price': 'Lowest price',
    'gallery.clear': 'Clear',
    'gallery.no_filter_matches': 'No photos match the current filters',
    'gallery.no_visible': 'No locally visible photos in this collection',
    'gallery.clear_filters': 'Clear filters',
    'gallery.adjust_filters': 'Adjust or clear filters to show this collection again.',
    'gallery.showing_count': 'Showing {count} photos.',
    'gallery.showing_filtered': 'Showing {count} of {total} after filters.',
    'gallery.reserve_available': '{status} Reserve refill is available.',
    'detail.pick_resolution': 'Pick a resolution',
    'detail.total_selected': 'Total selected:',
    'detail.archive_reset_title': 'Archive reset in progress',
    'detail.no_published_meta': '{collection} / No published photos yet',
    'detail.no_published': 'No published photos yet',
    'detail.rebuilding': 'This gallery is being rebuilt from the Saturn archive.',
    'detail.mp_verified': '{mp} MP verified',
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
    'basket.license_note': 'This basket is a static order draft. Final delivery, source availability, and any commercial or AI-related use are confirmed manually before fulfillment.',
    'basket.buyer_email': 'Buyer email',
    'basket.pay_guest': 'Pay as guest',
    'basket.simulate_payment': 'Simulate Stripe payment',
    'basket.checkout_note': 'Checkout uses USD. Stripe opens automatically when the Worker is configured for live payments; local mock mode can still generate delivery ZIPs.',
    'basket.assets_total': '{count} {assetWord}, ${total}',
    'basket.asset_singular': 'asset',
    'basket.asset_plural': 'assets',
    'basket.order_id': 'Order ID',
    'basket.photos': 'Photos',
    'basket.assets': 'Assets',
    'basket.draft_total': 'Draft total',
    'basket.collections': 'Collections',
    'basket.checkout_needs_asset': 'Checkout needs at least one digital asset in the basket.',
    'basket.enter_email': 'Enter a buyer email before starting checkout.',
    'basket.creating_checkout': 'Creating Checkout Session...',
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
    'order.build_zip': 'Build ZIP',
    'order.private_r2': 'Private R2',
    'order.download': 'Download',
    'order.ready_label': 'Ready',
    'order.waiting_payment': 'Waiting for payment',
    'order.building_zip': 'Building delivery ZIP',
    'order.delivery_blocked': 'Delivery blocked',
    'order.ready_download': 'Ready to download',
    'order.phase_3': 'Phase 3 of 3',
    'order.ready_message': 'Payment is complete and the ZIP has been generated from private storage.',
    'order.blocked_phase_2': 'Blocked after Phase 2',
    'order.delivery_attention': 'Delivery needs attention',
    'order.delivery_failed': 'Payment is complete, but the Worker could not generate the delivery ZIP.',
    'order.phase_2': 'Phase 2 of 3',
    'order.building_message': 'Payment is complete. The Worker is reading private R2 masters and writing the ZIP.',
    'order.payment_not_confirmed': 'Payment not confirmed',
    'order.payment_message': 'This page normally opens after checkout. If payment was just completed, refresh; otherwise return to checkout and finish payment before delivery starts.',
    'order.details_needed': 'Order details needed',
    'order.details_message': 'Open this page from checkout so the order number and buyer email are available.',
    'order.refreshing': 'Refreshing order...',
    'order.refreshed': 'Order refreshed.',
    'order.cached': 'Showing cached local order. Download uses the generated ZIP file on disk.',
    'order.unavailable': 'Order unavailable',
    'order.could_not_load': 'Could not load order from the local Worker.',
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
    'theme.night': 'Nuit',
    'theme.day': 'Jour',
    'home.lead': 'Une archive photo choisie, avec galeries par pays, images IA a part, et nouveaux apercus representatifs au fil du rail des collections.',
    'home.view_collections': 'Voir les collections',
    'home.collections': 'Collections',
    'home.archive_shape': 'Forme de l archive',
    'home.metric_owner': 'Owner',
    'home.metric_owner_label': 'Relit et publie le catalogue',
    'home.metric_groups': 'Groupes de collections publiques',
    'home.metric_fresh': 'Nouveau',
    'home.metric_fresh_label': 'Apercus tournants au fil des collections',
    'collection.france': 'France',
    'collection.usa': 'États-Unis',
    'collection.spain': 'Espagne',
    'collection.mexico': 'Mexique',
    'collection.ai': 'IA',
    'collection.portugal': 'Portugal',
    'collection.slovakia': 'Slovaquie',
    'common.back_to_collections': 'Retour aux collections',
    'common.back_to_gallery': 'Retour a la galerie',
    'common.previous': 'Precedent',
    'common.next': 'Suivant',
    'common.refresh': 'Actualiser',
    'common.photo': 'Photo',
    'common.photo_detail': 'Detail de la photo',
    'gallery.grid': 'Grille',
    'gallery.fit': 'Ajuster',
    'gallery.fill': 'Remplir',
    'gallery.orientation': 'Orientation',
    'gallery.color_mood': 'Ambiance couleur',
    'gallery.subject': 'Sujet',
    'gallery.sort': 'Tri',
    'gallery.all': 'Tout',
    'gallery.landscape': 'Paysage',
    'gallery.portrait': 'Portrait',
    'gallery.square': 'Carré',
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
    'gallery.highest_price': 'Prix haut',
    'gallery.lowest_price': 'Prix bas',
    'gallery.clear': 'Effacer',
    'gallery.no_filter_matches': 'Aucune photo ne correspond aux filtres',
    'gallery.no_visible': 'Aucune photo visible localement dans cette collection',
    'gallery.clear_filters': 'Effacer les filtres',
    'gallery.adjust_filters': 'Ajustez ou effacez les filtres pour revoir cette collection.',
    'gallery.showing_count': '{count} photos affichees.',
    'gallery.showing_filtered': '{count} sur {total} apres filtres.',
    'gallery.reserve_available': '{status} Le remplissage de reserve est disponible.',
    'detail.pick_resolution': 'Choisir une resolution',
    'detail.total_selected': 'Total choisi :',
    'detail.archive_reset_title': 'Reinitialisation de l archive',
    'detail.no_published_meta': '{collection} / Aucune photo publiee pour le moment',
    'detail.no_published': 'Aucune photo publiee pour le moment',
    'detail.rebuilding': 'Cette galerie est reconstruite depuis l archive Saturn.',
    'detail.mp_verified': '{mp} MP verifies',
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
    'basket.license_note': 'Ce panier est un brouillon de commande statique. La livraison finale, la disponibilite des sources et tout usage commercial ou lie a l IA sont confirmes manuellement avant execution.',
    'basket.buyer_email': 'Email acheteur',
    'basket.pay_guest': 'Payer comme invite',
    'basket.simulate_payment': 'Simuler le paiement Stripe',
    'basket.checkout_note': 'Le checkout utilise l USD. Stripe s ouvre automatiquement quand le Worker est configure pour les paiements reels; le mode mock local peut toujours generer des ZIP de livraison.',
    'basket.assets_total': '{count} {assetWord}, ${total}',
    'basket.asset_singular': 'fichier',
    'basket.asset_plural': 'fichiers',
    'basket.order_id': 'Commande',
    'basket.photos': 'Photos',
    'basket.assets': 'Fichiers',
    'basket.draft_total': 'Total brouillon',
    'basket.collections': 'Collections',
    'basket.checkout_needs_asset': 'Le checkout demande au moins un fichier numerique dans le panier.',
    'basket.enter_email': 'Saisissez un email acheteur avant de lancer le checkout.',
    'basket.creating_checkout': 'Creation de la session Checkout...',
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
    'order.build_zip': 'Creer ZIP',
    'order.private_r2': 'R2 prive',
    'order.download': 'Telechargement',
    'order.ready_label': 'Pret',
    'order.waiting_payment': 'Paiement en attente',
    'order.building_zip': 'Creation du ZIP',
    'order.delivery_blocked': 'Livraison bloquee',
    'order.ready_download': 'Pret a telecharger',
    'order.phase_3': 'Phase 3 sur 3',
    'order.ready_message': 'Le paiement est termine et le ZIP a ete genere depuis le stockage prive.',
    'order.blocked_phase_2': 'Bloque apres la phase 2',
    'order.delivery_attention': 'Livraison a verifier',
    'order.delivery_failed': 'Le paiement est termine, mais le Worker n a pas pu generer le ZIP.',
    'order.phase_2': 'Phase 2 sur 3',
    'order.building_message': 'Le paiement est termine. Le Worker lit les masters R2 prives et ecrit le ZIP.',
    'order.payment_not_confirmed': 'Paiement non confirme',
    'order.payment_message': 'Cette page s ouvre normalement apres le checkout. Si le paiement vient de se terminer, actualisez; sinon revenez au checkout pour terminer le paiement avant la livraison.',
    'order.details_needed': 'Details de commande requis',
    'order.details_message': 'Ouvrez cette page depuis le checkout afin que le numero de commande et l email acheteur soient disponibles.',
    'order.refreshing': 'Actualisation de la commande...',
    'order.refreshed': 'Commande actualisee.',
    'order.cached': 'Commande locale en cache affichee. Le telechargement utilise le ZIP genere sur disque.',
    'order.unavailable': 'Commande indisponible',
    'order.could_not_load': 'Impossible de charger la commande depuis le Worker local.',
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
    'theme.night': 'Noche',
    'theme.day': 'Dia',
    'home.lead': 'Un archivo fotografico seleccionado, con galerias por pais, obra IA separada y muestras representativas nuevas mientras gira el carril de colecciones.',
    'home.view_collections': 'Ver colecciones',
    'home.collections': 'Colecciones',
    'home.archive_shape': 'Forma del archivo',
    'home.metric_owner': 'Owner',
    'home.metric_owner_label': 'Revisa y publica el catalogo',
    'home.metric_groups': 'Grupos de colecciones publicas',
    'home.metric_fresh': 'Nuevo',
    'home.metric_fresh_label': 'Muestras rotativas al girar las colecciones',
    'collection.france': 'Francia',
    'collection.usa': 'EE. UU.',
    'collection.spain': 'España',
    'collection.mexico': 'México',
    'collection.ai': 'IA',
    'collection.portugal': 'Portugal',
    'collection.slovakia': 'Eslovaquia',
    'common.back_to_collections': 'Volver a colecciones',
    'common.back_to_gallery': 'Volver a la galeria',
    'common.previous': 'Anterior',
    'common.next': 'Siguiente',
    'common.refresh': 'Actualizar',
    'common.photo': 'Foto',
    'common.photo_detail': 'Detalle de foto',
    'gallery.grid': 'Cuadricula',
    'gallery.fit': 'Ajustar',
    'gallery.fill': 'Rellenar',
    'gallery.orientation': 'Orientacion',
    'gallery.color_mood': 'Color',
    'gallery.subject': 'Tema',
    'gallery.sort': 'Orden',
    'gallery.all': 'Todo',
    'gallery.landscape': 'Horizontal',
    'gallery.portrait': 'Vertical',
    'gallery.square': 'Cuadrada',
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
    'gallery.highest_price': 'Precio alto',
    'gallery.lowest_price': 'Precio bajo',
    'gallery.clear': 'Limpiar',
    'gallery.no_filter_matches': 'Ninguna foto coincide con los filtros',
    'gallery.no_visible': 'No hay fotos visibles localmente en esta coleccion',
    'gallery.clear_filters': 'Limpiar filtros',
    'gallery.adjust_filters': 'Ajusta o limpia los filtros para volver a mostrar esta coleccion.',
    'gallery.showing_count': 'Mostrando {count} fotos.',
    'gallery.showing_filtered': 'Mostrando {count} de {total} tras filtros.',
    'gallery.reserve_available': '{status} El relleno de reserva esta disponible.',
    'detail.pick_resolution': 'Elige una resolucion',
    'detail.total_selected': 'Total seleccionado:',
    'detail.archive_reset_title': 'Reinicio del archivo en curso',
    'detail.no_published_meta': '{collection} / Aun no hay fotos publicadas',
    'detail.no_published': 'Aun no hay fotos publicadas',
    'detail.rebuilding': 'Esta galeria se esta reconstruyendo desde el archivo Saturn.',
    'detail.mp_verified': '{mp} MP verificados',
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
    'basket.license_note': 'Esta cesta es un borrador de pedido estatico. La entrega final, disponibilidad de fuentes y cualquier uso comercial o relacionado con IA se confirman manualmente antes de cumplirlo.',
    'basket.buyer_email': 'Email del comprador',
    'basket.pay_guest': 'Pagar como invitado',
    'basket.simulate_payment': 'Simular pago Stripe',
    'basket.checkout_note': 'Checkout usa USD. Stripe se abre automaticamente cuando el Worker esta configurado para pagos reales; el modo mock local aun puede generar ZIPs de entrega.',
    'basket.assets_total': '{count} {assetWord}, ${total}',
    'basket.asset_singular': 'archivo',
    'basket.asset_plural': 'archivos',
    'basket.order_id': 'Pedido',
    'basket.photos': 'Fotos',
    'basket.assets': 'Archivos',
    'basket.draft_total': 'Total borrador',
    'basket.collections': 'Colecciones',
    'basket.checkout_needs_asset': 'Checkout necesita al menos un archivo digital en la cesta.',
    'basket.enter_email': 'Introduce un email de comprador antes de iniciar checkout.',
    'basket.creating_checkout': 'Creando sesion Checkout...',
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
    'order.build_zip': 'Crear ZIP',
    'order.private_r2': 'R2 privado',
    'order.download': 'Descarga',
    'order.ready_label': 'Listo',
    'order.waiting_payment': 'Esperando pago',
    'order.building_zip': 'Creando ZIP de entrega',
    'order.delivery_blocked': 'Entrega bloqueada',
    'order.ready_download': 'Listo para descargar',
    'order.phase_3': 'Fase 3 de 3',
    'order.ready_message': 'El pago esta completo y el ZIP se genero desde almacenamiento privado.',
    'order.blocked_phase_2': 'Bloqueado despues de fase 2',
    'order.delivery_attention': 'Entrega necesita atencion',
    'order.delivery_failed': 'El pago esta completo, pero el Worker no pudo generar el ZIP.',
    'order.phase_2': 'Fase 2 de 3',
    'order.building_message': 'El pago esta completo. El Worker lee masters privados de R2 y escribe el ZIP.',
    'order.payment_not_confirmed': 'Pago no confirmado',
    'order.payment_message': 'Esta pagina normalmente se abre despues del checkout. Si el pago acaba de completarse, actualiza; si no, vuelve al checkout y termina el pago antes de la entrega.',
    'order.details_needed': 'Faltan datos del pedido',
    'order.details_message': 'Abre esta pagina desde checkout para tener el numero de pedido y el email del comprador.',
    'order.refreshing': 'Actualizando pedido...',
    'order.refreshed': 'Pedido actualizado.',
    'order.cached': 'Mostrando pedido local en cache. La descarga usa el ZIP generado en disco.',
    'order.unavailable': 'Pedido no disponible',
    'order.could_not_load': 'No se pudo cargar el pedido desde el Worker local.',
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
};

window.photosByElieI18n = {
  t: translate,
  language: () => root.dataset.language || 'en',
  apply: applyTranslations,
};
const rawSourceTypes = new Set(['DNG', 'NEF', 'CR2', 'CR3', 'ARW', 'RAF', 'ORF', 'RW2', 'RAW', 'PEF', 'SRW', 'RWL']);
const localHostnames = new Set(['localhost', '127.0.0.1', '::1']);
const tapFirstQuery = window.matchMedia?.('(max-width: 760px) and (hover: none) and (pointer: coarse)');
let hasKeyboardInput = false;

const syncInputModeClass = () => {
  const isTapFirst = Boolean(tapFirstQuery?.matches);
  root.classList.toggle('is-localhost', localHostnames.has(window.location.hostname));
  root.classList.toggle('is-tap-first', isTapFirst);
  root.classList.toggle('has-keyboard-input', hasKeyboardInput);
};

window.photosByElieInputMode = {
  isLocalhost: () => localHostnames.has(window.location.hostname),
  isTapFirst: () => Boolean(tapFirstQuery?.matches),
  hasKeyboardInput: () => hasKeyboardInput,
  shouldShowKeyboardHints: () => localHostnames.has(window.location.hostname) || !tapFirstQuery?.matches || hasKeyboardInput,
  applyKeyboardHint: (element, enabled = true) => {
    if (!element) return;
    element.hidden = !enabled || !window.photosByElieInputMode.shouldShowKeyboardHints();
  }
};

const productSettingsKey = 'photosbyelie-product-settings';
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
    frames: Object.fromEntries((window.photosByElieFrameOptions || []).map((frame) => [frame.id, {
      price: Number(frame.price) || 0,
      prices: { ...(frame.prices || {}) },
    }])),
    shippingHandling: { ...(window.photosByElieShippingHandlingPrices || {}) },
  };
  return productPriceDefaults;
};
const cleanPriceOverrides = (overrides = {}) => ({
  options: Object.fromEntries(Object.entries(overrides.options || {})
    .map(([id, value]) => [id, Math.max(0, Number(value) || 0)])),
  frames: Object.fromEntries(Object.entries(overrides.frames || {}).map(([id, frame]) => [id, {
    price: Math.max(0, Number(frame?.price) || 0),
    prices: Object.fromEntries(Object.entries(frame?.prices || {})
      .map(([optionId, value]) => [optionId, Math.max(0, Number(value) || 0)])),
  }])),
  shippingHandling: Object.fromEntries(Object.entries(overrides.shippingHandling || {})
    .map(([id, value]) => [id, Math.max(0, Number(value) || 0)])),
});
const applyProductPriceOverrides = () => {
  const defaults = captureProductPriceDefaults();
  if (!defaults) return {};
  const overrides = cleanPriceOverrides(readProductSettings().priceOverrides || {});
  (window.photosByElieResolutions || []).forEach((option) => {
    option.price = overrides.options[option.id] ?? defaults.options[option.id] ?? (Number(option.price) || 0);
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
  physicalProductsEnabled: () => (
    window.photosByElieInputMode.isLocalhost()
    && readProductSettings().physicalProductsEnabled === true
  ),
  setPhysicalProductsEnabled: (enabled) => {
    if (!window.photosByElieInputMode.isLocalhost()) return false;
    const settings = { ...readProductSettings(), physicalProductsEnabled: Boolean(enabled) };
    writeProductSettings(settings);
    window.dispatchEvent(new CustomEvent('photosbyelie:productsettingschange', { detail: settings }));
    return settings.physicalProductsEnabled;
  }
};

syncInputModeClass();
tapFirstQuery?.addEventListener?.('change', () => {
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
const defaultMediaBase = isLocalhostMediaPage
  ? ''
  : configuredMediaBase;
window.photosByEliePublicMediaBase = normalizePublicMediaBase(
  explicitMediaBase || (isLocalhostMediaPage ? window.photosByEliePublicMediaBase : '') || defaultMediaBase
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

window.photosByElieLocalMediaUrl = (photo, size = 'gallery') => {
  if (!photo) return '';
  if (size === 'detail') return photo.imageSrc || photo.gallerySrc || '';
  return photo.gallerySrc || photo.imageSrc || '';
};

window.photosByElieMediaUrl = (photo, size = 'gallery') => {
  const key = window.photosByElieMediaKey(photo, size);
  const base = normalizePublicMediaBase(window.photosByEliePublicMediaBase);
  if (base && key) return `${base}/${key.replace(/^\/+/, '')}`;
  if (base && photo?.media?.publicPreview?.allowed === false) {
    return window.photosByElieInputMode.isLocalhost() ? window.photosByElieLocalMediaUrl(photo, size) : '';
  }
  if (!base && window.photosByElieMediaStatus().requiresPublicMedia && key) return '';
  return window.photosByElieLocalMediaUrl(photo, size);
};

window.photosByElieMetadataValue = (photo, label) => (
  (photo?.metadata || []).find((item) => item.label === label)?.value || ''
);

window.photosByEliePreviewDimensions = (photo) => {
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

window.photosByElieCssUrlValue = (url) => `url("${String(url || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[\n\r]/g, "")}")`;

window.photosByElieMdIcon = (name) => {
  const paths = {
    favorite: 'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z',
    favoriteBorder: 'M16.5 3c-1.74 0-3.41.81-4.5 2.09C10.91 3.81 9.24 3 7.5 3 4.42 3 2 5.42 2 8.5c0 3.78 3.4 6.86 8.55 11.54L12 21.35l1.45-1.32C18.6 15.36 22 12.28 22 8.5 22 5.42 19.58 3 16.5 3zm-4.4 15.55-.1.1-.1-.1C7.14 14.24 4 11.39 4 8.5 4 6.5 5.5 5 7.5 5c1.54 0 3.04.99 3.57 2.36h1.87C13.46 5.99 14.96 5 16.5 5 18.5 5 20 6.5 20 8.5c0 2.89-3.14 5.74-7.9 10.05z',
    shoppingBasket: 'M17.21 9l-4.38-6.56c-.19-.28-.51-.42-.83-.42s-.64.14-.83.43L6.79 9H2c-.55 0-1 .45-1 1 0 .09.01.18.04.27l2.54 9.27C3.81 20.39 4.59 21 5.5 21h13c.91 0 1.69-.61 1.93-1.46l2.54-9.27L23 10c0-.55-.45-1-1-1h-4.79zM9 9l3-4.4L15 9H9zm3 8c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z'
  };
  const path = paths[name] || paths.favoriteBorder;
  return `<svg class="md-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${path}"></path></svg>`;
};

const ensureHeaderActionLinks = () => {
  const controls = document.querySelector('.header-controls');
  if (!controls || controls.querySelector('[data-header-actions]')) return;
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
  `;
  controls.prepend(actions);
};

ensureHeaderActionLinks();

document.querySelectorAll('[data-back-to-top]').forEach((button) => {
  button.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
});

btn?.addEventListener('click', () => {
  root.dataset.theme = root.dataset.theme === 'light' ? 'dark' : 'light';
  localStorage.setItem(key, root.dataset.theme);
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
