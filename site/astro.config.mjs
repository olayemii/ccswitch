import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://ccswitch.github.io',
  integrations: [
    starlight({
      title: 'ccswitch',
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/ccswitch/ccswitch' }],
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
