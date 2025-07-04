import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"

export default defineConfig({
	plugins: [react()],
	base: './',
	build: {
		outDir: 'src/bowser/dist/',
		minify: false,
		cssMinify: false,
		rollupOptions: {
			output: {
				entryFileNames: `[name].js`,
				assetFileNames: `[name].[ext]`
			}
		}
	},
	server: {
		proxy: {
			'/datasets': 'http://localhost:8000',
			'/mode': 'http://localhost:8000',
			'/point': 'http://localhost:8000',
			'/chart_point': 'http://localhost:8000',
			'/multi_point': 'http://localhost:8000',
			'/trend_analysis': 'http://localhost:8000',
			'/md': 'http://localhost:8000',
			'/cog': 'http://localhost:8000'
		}
	}
})
