/** @type {import('tailwindcss').Config} */
export default {
	content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
	theme: {
		extend: {
			colors: {
				'brand':   '#80131d',
				'accent':  '#a81624',
				'green':   '#acb370',
				'sage':    '#8B9765',
				'cream':   '#f5f3ef',
				'tan':     '#c4bbaa',
				'carbon':  '#1a1a1a',
			},
			fontFamily: {
				'cap': ['Capriola', 'sans-serif'],
				'rob': ['Roboto', 'sans-serif'],
			}
		},
	},
	plugins: [],
}
