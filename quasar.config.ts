import { defineConfig } from '@quasar/app-vite'

export default defineConfig(() => ({
  boot: [],
  css: ['app.scss'],
  extras: [],
  framework: { config: { brand: { primary: '#2563eb', secondary: '#0f766e', positive: '#15803d', negative: '#b91c1c' } }, plugins: ['Notify'] },
  build: { vueOptionsAPI: true, vueRouterMode: 'hash', publicPath: './', target: { browser: ['es2022'], node: 'node22' } },
  devServer: { open: false, strictPort: true },
}))
