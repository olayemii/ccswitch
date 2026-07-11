import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://olayemii.github.io',
  base: '/ccswitch',
  integrations: [
    starlight({
      title: 'ccswitch',
      customCss: ['./src/styles/docs.css'],
      components: {
        ThemeProvider: './src/components/ThemeProvider.astro',
      },
      head: [
        { tag: 'link', attrs: { rel: 'preconnect', href: 'https://fonts.googleapis.com' } },
        { tag: 'link', attrs: { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: true } },
        {
          tag: 'link',
          attrs: {
            rel: 'stylesheet',
            href: 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600;700&family=Space+Mono:wght@400;700&display=swap',
          },
        },
      ],
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/olayemii/ccswitch' }],
      sidebar: [
        {
          label: 'Getting Started',
          items: [{ autogenerate: { directory: 'getting-started' } }],
        },
        {
          label: 'Commands',
          items: [{ autogenerate: { directory: 'commands' } }],
        },
        {
          label: 'Concepts',
          items: [{ autogenerate: { directory: 'concepts' } }],
        },
        {
          label: 'Auth Types',
          items: [{ autogenerate: { directory: 'auth-types' } }],
        },
        {
          label: 'Troubleshooting',
          items: [{ autogenerate: { directory: 'troubleshooting' } }],
        },
      ],
    }),
  ],
});
