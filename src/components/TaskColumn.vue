<script setup lang="ts">
const props=defineProps<{category:string;label:string;add?:()=>void;area?:boolean}>()
function background(event:MouseEvent) {
  if (props.add && event.target instanceof Element &&
      !event.target.closest('button,a,input,select,textarea,summary,label,[data-round-key],[data-overview-ref],[data-gantt-root],[data-deferred-source],.three-day-strip,.mw-column-meter')) {
    event.stopPropagation()
    props.add()
  }
}
</script>
<template>
  <q-card flat bordered class="cal-col" :data-category="category" :data-overview-list="category" @click="background">
    <slot />
    <button v-if="add&&area" type="button" class="overview-add-area" :aria-label="label" @click.stop="add"></button>
  </q-card>
</template>
