<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch } from 'vue'
const props = defineProps<{ html: string }>()
const root = ref<HTMLElement>()
const update = () => { if (root.value) root.value.innerHTML = props.html || '' }
onMounted(update)
watch(() => props.html, update)
onBeforeUnmount(() => { if (root.value) root.value.replaceChildren() })
</script>
<template><div ref="root" /></template>
