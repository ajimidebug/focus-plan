import { defineRouter } from '@quasar/app-vite'
import { createRouter, createWebHashHistory } from 'vue-router'

export const views = new Set(['memo','tasks','timeline','memo-timeaxis','checkin','memo-history','calendar','stats','cards','mistakes','sport','settings','memo-review'])
export default defineRouter(() => createRouter({
  history: createWebHashHistory(),
  routes: [{ path: '/:page?', component: { render: () => null } }],
}))
