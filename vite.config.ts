import { defineConfig } from "vite"
import { resolve } from 'path'

// Determine if we're building the widget or the main app
const buildWidget = process.env.BUILD_TARGET === 'widget';

export default defineConfig({
	base: './',
	build: {
		outDir: 'src/bowser/dist/',
		minify: false,
		cssMinify: false,
		...(buildWidget ? {
			// Widget build configuration
			lib: {
				entry: resolve(__dirname, 'src/widget.ts'),
				name: 'BowserWidget',
				formats: ['es'],
				fileName: 'widget'
			},
			rollupOptions: {
				external: [], // Don't externalize anything for the widget
				output: {
					format: 'es'
				}
			}
		} : {
			// Main app build configuration
			rollupOptions: {
				input: {
					main: resolve(__dirname, 'index.html'),
				},
				output: {
					entryFileNames: `[name].js`,
					assetFileNames: `[name].[ext]`
				}
			}
		})
	},
})
