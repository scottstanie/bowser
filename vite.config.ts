import { defineConfig } from "vite"
// https://github.com/richardtallent/vite-plugin-singlefile
// Bundles JS/CSS into a single HTML file
// import { viteSingleFile } from "vite-plugin-singlefile"

export default defineConfig({
	// plugins: [viteSingleFile()],
	// https://stackoverflow.com/a/69746868/4174466
	base: './',
	server: {
		proxy: {
			'/mode': 'http://localhost:8000',
			'/datasets': 'http://localhost:8000',
			'/colorbar': 'http://localhost:8000',
			'/md': 'http://localhost:8000',
			'/cog': 'http://localhost:8000',
			'/point': 'http://localhost:8000',
			'/chart_point': 'http://localhost:8000',
		}
	},
	build: {
		outDir: 'src/bowser/dist/',
		minify: false,
		cssMinify: false,
		rollupOptions: {
			output: {
				// https://github.com/vitejs/vite/issues/378
				entryFileNames: `[name].js`,
				assetFileNames: `[name].[ext]`
			}
		}
	},
})
