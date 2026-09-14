import { defineStore } from 'pinia';
import { ref } from 'vue';
import { http } from '../api/http.js';

export const useCatalogStore = defineStore('catalog', () => {
  const meta = ref({ rarities: [], categories: [], servers: [] });
  const loaded = ref(false);
  let pending;
  async function load() {
    if (loaded.value) return meta.value;
    if (pending) return pending;
    pending = http.get('/meta').then((result) => {
      meta.value = result;
      loaded.value = true;
      return result;
    }).finally(() => { pending = undefined; });
    return pending;
  }
  function rarity(value) { return meta.value.rarities.find((item) => item.value === value); }
  function category(value) { return meta.value.categories.find((item) => item.value === value)?.label || value; }
  return { meta, loaded, load, rarity, category };
});
