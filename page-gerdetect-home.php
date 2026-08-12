<?php
/**
 * Template Name: Detector Store Landing
 *
 * Original ecommerce landing page inspired by premium detector stores.
 * Replace placeholder blocks with licensed product images in WordPress/WoodMart.
 *
 * @package GERDetectInspired
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

get_header();

$featured_products = array(
	array( 'name' => 'Titan X13 Detector', 'price' => '13,000 $', 'text' => 'Multi-system detector for gold, metals, gemstones, caves, voids, and archaeological targets.' ),
	array( 'name' => 'UIG Ground Scanner', 'price' => '3,000 $', 'text' => 'Three professional scan modes for live ground, wall, and 3D imaging exploration.' ),
	array( 'name' => 'Gold Digger Pro', 'price' => '2,200 $', 'text' => 'A compact gold and metal detecting device designed for dependable field operation.' ),
);

$catalog_products = array(
	array( 'name' => 'UIG Watch Detector', 'price' => '2,299 $', 'text' => 'Small concealed imaging device for precious metals, treasures, caves, and tombs.' ),
	array( 'name' => 'Easy Way Smart', 'price' => '3,750 $', 'text' => 'Portable radar sensing and 3D imaging for gold, treasures, precious metals, and voids.' ),
	array( 'name' => 'Deep Seeker Detector', 'price' => '5,500 $', 'old' => '7,500 $', 'text' => 'Five-system exploration station for gold, treasures, antiquities, metals, and diamonds.' ),
	array( 'name' => 'Titan GER 1000', 'price' => '8,000 $', 'old' => '12,500 $', 'text' => 'Complete search system for buried gold, treasures, caves, voids, and tombs.' ),
	array( 'name' => 'River-F Smart', 'price' => '2,250 $', 'old' => '3,000 $', 'text' => 'Long-range water finder for groundwater, artesian wells, and underground springs.' ),
	array( 'name' => 'Diamond Hunter Smart', 'price' => '2,250 $', 'old' => '2,500 $', 'text' => 'Long-range search device for diamonds, gemstones, and underground targets.' ),
);
?>

<main class="gd-landing">
	<section class="gd-topbar">
		<div class="gd-wrap">
			<div class="gd-contact">
				<a href="https://wa.me/4915778624383">+49 1577 8624383</a>
				<a href="mailto:info@example.com">info@example.com</a>
			</div>
			<div class="gd-actions">
				<a href="<?php echo esc_url( function_exists( 'wc_get_page_permalink' ) ? wc_get_page_permalink( 'myaccount' ) : wp_login_url() ); ?>">Sign in</a>
				<a href="<?php echo esc_url( function_exists( 'wc_get_cart_url' ) ? wc_get_cart_url() : home_url( '/cart/' ) ); ?>">Cart</a>
			</div>
		</div>
	</section>

	<header class="gd-header">
		<div class="gd-wrap">
			<a class="gd-logo" href="<?php echo esc_url( home_url( '/' ) ); ?>">GER <span>Detect</span></a>
			<nav class="gd-nav" aria-label="Landing navigation">
				<a href="#featured">Gold Detectors</a>
				<a href="#treasure">Treasure & Void</a>
				<a href="#long-range">Long Range</a>
				<a href="#certifications">Certifications</a>
			</nav>
		</div>
	</header>

	<section class="gd-hero">
		<div class="gd-wrap gd-hero-grid">
			<div>
				<div class="gd-kicker">German-engineered detector technology</div>
				<h1>The best gold detectors and metal detection devices</h1>
				<p>Build a premium WoodMart storefront for gold, metal, treasure, void, diamond, gemstone, and groundwater detection devices with conversion-focused product sections.</p>
				<a class="gd-button" href="#featured">Explore Devices</a>
			</div>
			<div class="gd-hero-visual" aria-label="Featured detector image placeholder">
				<div class="gd-device-placeholder">Upload your licensed hero/product image here via WoodMart or the WordPress media library.</div>
			</div>
		</div>
	</section>

	<section id="featured" class="gd-section">
		<div class="gd-wrap">
			<h2 class="gd-section-title">Featured gold and metal detectors</h2>
			<p class="gd-section-intro">Showcase your best-selling detector products with short benefits, prices, and WooCommerce calls to action.</p>
			<div class="gd-grid">
				<?php foreach ( $featured_products as $product ) : ?>
					<article class="gd-card">
						<div class="gd-card-image">Product image placeholder</div>
						<h3><?php echo esc_html( $product['name'] ); ?></h3>
						<p><?php echo esc_html( $product['text'] ); ?></p>
						<span class="gd-price"><?php echo esc_html( $product['price'] ); ?></span>
						<a class="button" href="#">Learn more</a>
					</article>
				<?php endforeach; ?>
			</div>
		</div>
	</section>

	<section id="treasure" class="gd-section">
		<div class="gd-wrap gd-feature-band">
			<h2 class="gd-section-title">Treasure & Void Detectors</h2>
			<p class="gd-section-intro">A premium category block for devices designed to detect precious metals, ancient artifacts, caves, voids, passages, and underground targets.</p>
		</div>
	</section>

	<section id="long-range" class="gd-section">
		<div class="gd-wrap">
			<h2 class="gd-section-title">Long-range search systems</h2>
			<p class="gd-section-intro">Use this grid for WooCommerce products or WoodMart product elements. The layout mirrors a modern detector catalog while keeping imagery replaceable with your own licensed assets.</p>
			<div class="gd-grid">
				<?php foreach ( $catalog_products as $product ) : ?>
					<article class="gd-product">
						<div class="gd-product-image">Licensed image</div>
						<h3><?php echo esc_html( $product['name'] ); ?></h3>
						<p><?php echo esc_html( $product['text'] ); ?></p>
						<span class="gd-price"><?php echo isset( $product['old'] ) ? '<del>' . esc_html( $product['old'] ) . '</del> ' : ''; ?><?php echo esc_html( $product['price'] ); ?></span>
						<a class="button" href="#">Add to cart</a>
					</article>
				<?php endforeach; ?>
			</div>
		</div>
	</section>

	<section id="certifications" class="gd-section">
		<div class="gd-wrap">
			<h2 class="gd-section-title">Certifications and Accreditations</h2>
			<p class="gd-section-intro">Communicate manufacturing quality, compliance, and customer trust signals in a clean three-column certification area.</p>
			<div class="gd-grid gd-cert-grid">
				<div class="gd-cert"><strong>CE Mark</strong><p>European conformity badge placeholder.</p></div>
				<div class="gd-cert"><strong>ISO 9001</strong><p>Quality management badge placeholder.</p></div>
				<div class="gd-cert"><strong>German Quality</strong><p>Manufacturing and engineering badge placeholder.</p></div>
			</div>
		</div>
	</section>

	<footer class="gd-footer">
		<div class="gd-wrap gd-footer-grid">
			<div><div class="gd-logo">GER <span>Detect</span></div><p>High-quality gold, metal, treasure, and water detectors.</p></div>
			<div><strong>Company</strong><ul><li><a href="#">Contact Us</a></li><li><a href="#">Privacy Policy</a></li><li><a href="#">Terms & Conditions</a></li></ul></div>
			<div><strong>Categories</strong><ul><li>Gold and Metal Detectors</li><li>Diamond and Gemstone Detectors</li><li>Underground Water Detectors</li></ul></div>
		</div>
		<div class="gd-wrap gd-copyright">All rights reserved.</div>
	</footer>
</main>

<?php
get_footer();
