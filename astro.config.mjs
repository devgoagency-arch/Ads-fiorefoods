import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://wholesale.fiorefoodscanada.com',
  integrations: [tailwind(), sitemap()],
  image: {
    domains: ['fiorefoodscanada.com']
  }
});