/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  // Includes .design-sync/previews/ so classes used only in authored preview
  // compositions (demo wrappers, etc.) still land in the compiled stylesheet
  // that design-sync ships — components themselves never depend on this.
  content: ['./src/**/*.{ts,tsx}', '../.design-sync/previews/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: '#E5007D',
        brandDark: '#c2185b',
        status: {
          vms: '#d9d9d9',
          apFrozen: '#DA9694',
          apOnly: '#ffc000',
          noCall: '#FF0000',
          portExcluded: '#fecaca',
        },
        chip: {
          subTrade: '#a9d08e',
          subTradeDark: '#3d5a34',
          coast: '#c00000',
          analyst: '#ed7d31',
          lane: '#E5007D',
          saleWeek: '#555555',
          yard: '#ed7d31',
        },
        table: {
          head: '#333333',
          subhead: '#444444',
          currentLaden: '#d9e1f2',
          totalTint: '#eef2fa',
          panel: '#e7e6e6',
          subTradeCell: '#e2efda',
          laneCellBg: '#bdd7ee',
          laneCellText: '#2f5597',
          inlandTint: '#DDD9C3',
          portTint: '#C4BD97',
          inlandPortTotal: '#E3ECF8',
          bsaTint: '#DAEEF3',
          utilizHeaderBg: '#FDE9D9',
          utilizHeaderText: '#974706',
          reeferFallback: '#E4DFEC',
          vcoFallback: '#EBF1DE',
          etaBlue: '#3172C4',
        },
        page: {
          light: '#f3f3f3',
          dark: '#0f1115',
        },
        action: {
          export: '#333333',
          analyze: '#1d4ed8',
          warningBg: '#ffe699',
          warningBgDark: '#b8860b',
          warningHover: '#ffd966',
          warningHoverDark: '#a67a0a',
        },
      },
      boxShadow: {
        // Documented Chromium sticky-header + border-collapse rendering-bug
        // workaround from the source report: a 1px hairline drawn via
        // box-shadow instead of a real border, so it survives sticky + collapse.
        'sticky-head': '0 1px 2px rgba(0,0,0,0.05), 0 1px 0 black',
      },
    },
  },
  plugins: [],
};
