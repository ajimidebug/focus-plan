import { defineStore } from 'pinia'

// This store holds display state only. Domain records remain in App.store.
export const useScreen = defineStore('screen', {
  state: () => ({ ready: false, failed: '', more: false, view: 'memo', storage: '正在读取记录', phase: 'loading', revision: 0, modalCount: 0, dirtyDialogs: 0 }),
})
