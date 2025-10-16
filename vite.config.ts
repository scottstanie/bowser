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
})
