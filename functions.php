<?php
/**
 * Theme setup for the GER Detect inspired WoodMart child theme.
 *
 * @package GERDetectInspired
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

add_action( 'wp_enqueue_scripts', 'gerdetect_inspired_enqueue_assets', 20 );

/**
 * Enqueue parent and child theme styles.
 */
function gerdetect_inspired_enqueue_assets() {
	wp_enqueue_style( 'woodmart-style', get_template_directory_uri() . '/style.css', array(), wp_get_theme( 'woodmart' )->get( 'Version' ) );
	wp_enqueue_style(
		'gerdetect-inspired-style',
		get_stylesheet_directory_uri() . '/assets/css/landing.css',
		array( 'woodmart-style' ),
		wp_get_theme()->get( 'Version' )
	);
}
