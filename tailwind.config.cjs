/** @type {import('tailwindcss').Config} */
// eslint-disable-next-line no-undef
module.exports = {
    darkMode: ["class"],
    content: ["./index.html", "./src/**/*.{ts,tsx,js,jsx}"],
  mode: "jit",
  variants: {
	extend: {
		display: ["group-hover"],
	}
  },
  theme: {
  	extend: {
  		colors: {
  			primary: {
  				DEFAULT: 'hsl(var(--primary))',
  				foreground: 'hsl(var(--primary-foreground))'
  			},
  			secondary: {
  				DEFAULT: 'hsl(var(--secondary))',
  				foreground: 'hsl(var(--secondary-foreground))'
  			},
  			offWhite: 'oklch(70.8% 0 0)',
  			lightSecondary: 'hsl(var(--primary))',
  			lightGold: '#fbbf24',
  			extraLightGray: 'hsl(var(--background))',
  			lightGray: 'hsl(var(--muted))',
			darkGray: 'hsl(var(--background))',
			midDarkGray: 'hsl(var(--card))',
			extraDarkGray: 'hsl(var(--card))',
  			blueGray: 'hsl(var(--muted-foreground))',
  			dimWhite: 'rgba(255, 255, 255, 0.7)',
  			dimBlue: 'rgba(9, 151, 124, 0.1)',
  			brand: {
  				mint: 'hsl(var(--brand-mint))',
  				ink: 'hsl(var(--on-mint))',
  				violet: 'hsl(var(--brand-violet))'
  			},
  			status: {
  				paid: { DEFAULT: 'hsl(var(--paid-bg))', foreground: 'hsl(var(--paid-ink))' },
  				overdue: { DEFAULT: 'hsl(var(--overdue-bg))', foreground: 'hsl(var(--overdue-ink))' },
  				waiting: { DEFAULT: 'hsl(var(--waiting-bg))', foreground: 'hsl(var(--waiting-ink))' },
  				active: { DEFAULT: 'hsl(var(--active-bg))', foreground: 'hsl(var(--active-ink))' }
  			},
  			background: 'hsl(var(--background))',
  			foreground: 'hsl(var(--foreground))',
  			card: {
  				DEFAULT: 'hsl(var(--card))',
  				foreground: 'hsl(var(--card-foreground))'
  			},
  			popover: {
  				DEFAULT: 'hsl(var(--popover))',
  				foreground: 'hsl(var(--popover-foreground))'
  			},
  			muted: {
  				DEFAULT: 'hsl(var(--muted))',
  				foreground: 'hsl(var(--muted-foreground))'
  			},
  			accent: {
  				DEFAULT: 'hsl(var(--accent))',
  				foreground: 'hsl(var(--accent-foreground))'
  			},
  			destructive: {
  				DEFAULT: 'hsl(var(--destructive))',
  				foreground: 'hsl(var(--destructive-foreground))'
  			},
  			border: 'hsl(var(--border))',
  			input: 'hsl(var(--input))',
  			ring: 'hsl(var(--ring))',
  			chart: {
  				'1': 'hsl(var(--chart-1))',
  				'2': 'hsl(var(--chart-2))',
  				'3': 'hsl(var(--chart-3))',
  				'4': 'hsl(var(--chart-4))',
  				'5': 'hsl(var(--chart-5))'
  			},
  			sidebar: {
  				DEFAULT: 'hsl(var(--sidebar-background))',
  				foreground: 'hsl(var(--sidebar-foreground))',
  				primary: 'hsl(var(--sidebar-primary))',
  				'primary-foreground': 'hsl(var(--sidebar-primary-foreground))',
  				accent: 'hsl(var(--sidebar-accent))',
  				'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
  				border: 'hsl(var(--sidebar-border))',
  				ring: 'hsl(var(--sidebar-ring))'
  			}
  		},
  		fontFamily: {
  			main: [
  				'var(--font-display)',
  				'sans-serif'
  			],
  			second: [
  				'var(--font-sans)',
  				'system-ui',
  				'sans-serif'
  			],
			third: [
				'var(--font-sans)',
				'system-ui',
				'sans-serif'
			],
			tertiary: [
				'var(--font-sans)',
				'system-ui',
				'sans-serif'
			]
  		},
  		borderRadius: {
  			lg: 'var(--radius)',
  			md: 'calc(var(--radius) - 2px)',
  			sm: 'calc(var(--radius) - 4px)'
  		},
  		spacing: {
  			golden: '1.618rem',
  			goldenSm: '0.618rem'
  		},
  		keyframes: {
  			'accordion-down': {
  				from: {
  					height: '0'
  				},
  				to: {
  					height: 'var(--radix-accordion-content-height)'
  				}
  			},
  			'accordion-up': {
  				from: {
  					height: 'var(--radix-accordion-content-height)'
  				},
  				to: {
  					height: '0'
  				}
  			}
  		},
  		animation: {
  			'accordion-down': 'accordion-down 0.2s ease-out',
  			'accordion-up': 'accordion-up 0.2s ease-out'
  		}
  	},
  	screens: {
  		xs: '480px',
  		ss: '620px',
  		sm: '768px',
  		md: '1060px',
  		lg: '1200px',
  		xl: '1700px'
  	}
  },
  // eslint-disable-next-line no-undef, @typescript-eslint/no-require-imports
  plugins: [require("tailwindcss-animate")],
};
