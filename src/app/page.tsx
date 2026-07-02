import type { Metadata } from 'next'
import { GsapAnimations } from './whatsapp-business-api/gsap-animations'
import {
  Check,
  IndianRupee,
  MessageSquare,
  Users,
  Zap,
  BarChart3,
  Bot,
  ShoppingCart,
  Settings,
  Sparkles,
  Shield,
  CheckCircle,
  Mail,
  Globe,
  Smartphone,
  CreditCard,
  LogIn,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@/components/ui/card'

export const metadata: Metadata = {
  title: 'Yuvmedia — WhatsApp Business API Annual Package',
  description: 'Broadcast on WhatsApp. Billed per message, not per guess.',
}

const features = [
  { icon: Users, title: '5,000 Contacts' },
  { icon: MessageSquare, title: '50,000 Messages' },
  { icon: Zap, title: 'Broadcasting' },
  { icon: Bot, title: 'Automation' },
  { icon: BarChart3, title: 'CRM & Analytics' },
  { icon: Settings, title: 'Flow Builder' },
  { icon: ShoppingCart, title: 'Integrations' },
  { label: 'AI Auto-Chat', badge: 'Coming soon', icon: Sparkles },
]

const rates = [
  { name: 'Marketing', price: '₹0.8631', per: 'per message' },
  { name: 'Utility', price: '₹0.1150', per: 'per message' },
  { name: 'Authentication', price: '₹0.1150', per: 'per message' },
  { name: 'Service', price: 'Free', per: 'always, no charge', free: true },
]

const requirements = [
  '1 Facebook Business account',
  'A domain email address',
  'A new mobile number, not active on WhatsApp',
  'GST number',
]

export default function WhatsAppAPIPage() {
  return (
    <>
      <GsapAnimations>
        <div className="min-h-screen bg-background text-foreground font-sans antialiased"
          style={{ backgroundImage: `radial-gradient(circle, rgba(255,255,255,0.03) 1px, transparent 1px)`, backgroundSize: '24px 24px' }}>
          <div className="mx-auto max-w-[1040px] px-6">

            {/* Nav */}
            <header className="flex flex-wrap items-center justify-between gap-2.5 pb-2 pt-7">
              <div className="flex items-center gap-2.5 text-lg font-semibold text-foreground">
                <img
                  src="/icon.png"
                  alt="Marbiz"
                  className="h-9 w-9 rounded-xl object-cover"
                />
                <span>Marbiz</span>
              </div>
              <div className="rounded-full border border-border bg-card/80 px-3 py-1.5 font-mono text-xs text-muted-foreground backdrop-blur-sm">
                WhatsApp Business API Solutions
              </div>
              <Button variant="outline" size="sm" nativeButton={false} render={<a href="/login" />}>
                <LogIn className="h-3.5 w-3.5" />
                Log in
              </Button>
            </header>

            {/* Hero */}
            <section className="relative grid grid-cols-[1.15fr_0.85fr] gap-12 pb-16 pt-12 max-md:grid-cols-1 max-md:pb-11 max-md:pt-7">
              <div className="relative z-10">
                <p
                  data-anim="hero-eyebrow"
                  className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/10 px-4 py-1 font-mono text-[0.76rem] font-medium uppercase tracking-[0.09em] text-primary"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  WhatsApp Business API · Annual Package
                </p>
                <h1
                  data-anim="hero-heading"
                  className="mt-6 font-heading text-[clamp(2.1rem,4.6vw,3.2rem)] font-bold leading-[1.12] tracking-[-0.01em]"
                >
                  <span className="bg-gradient-to-r from-foreground via-foreground to-primary bg-clip-text text-transparent">
                    Broadcast on WhatsApp.
                  </span>
                  <br />
                  <span className="text-foreground">Billed per message, not per guess.</span>
                </h1>
                <p
                  data-anim="hero-text"
                  className="mt-[18px] max-w-[480px] text-[1.08rem] leading-relaxed text-muted-foreground"
                >
                  One panel for bulk campaigns, automation, and lead tracking — built on the
                  official WhatsApp Business API, billed at Meta&apos;s standard India conversation
                  rates.
                </p>
              </div>

              <div
                data-anim="hero-bubble"
                className="relative flex items-center justify-center max-md:order-first"
              >
                <div className="relative w-full max-w-[300px]">
                  <div className="absolute -inset-1 rounded-3xl bg-gradient-to-br from-primary to-primary/50 opacity-60 blur-xl" />
                  <div className="relative rounded-3xl border border-primary/20 bg-gradient-to-br from-card via-card to-primary/20 p-[30px_32px_26px] shadow-2xl shadow-primary/20">
                    <span className="mb-2 block font-mono text-[0.78rem] uppercase tracking-[0.08em] text-muted-foreground">
                      Annual plan
                    </span>
                    <span className="flex items-baseline gap-1 font-heading text-[2.6rem] font-bold leading-none tracking-[-0.02em] text-foreground">
                      <IndianRupee className="h-8 w-8" />
                      15,000
                      <small className="ml-1.5 font-mono text-base font-medium text-muted-foreground">
                        +GST
                      </small>
                    </span>
                    <div className="mt-5 flex items-center gap-2 border-t border-border pt-4 text-[0.84rem] text-muted-foreground">
                      <Check className="h-4 w-4 flex-none text-primary" />
                      <span>12 months validity</span>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* Rates */}
            <section data-anim="section" className="border-t border-border py-14 max-md:py-9">
              <p className="mb-2.5 font-mono text-[0.76rem] font-medium uppercase tracking-[0.09em] text-primary">
                Per-message rates · India
              </p>
              <h2 className="font-heading text-[clamp(1.5rem,2.8vw,2rem)] font-semibold leading-[1.2] tracking-[-0.01em]">
                What each template message costs
              </h2>
              <p className="mt-3.5 max-w-[560px] text-base leading-relaxed text-muted-foreground">
                Meta&apos;s official India conversation rates, billed per approved template
                category — not per contact in your list.
              </p>
              <div className="mt-7 grid grid-cols-4 gap-4 max-md:grid-cols-2 max-sm:grid-cols-1">
                {rates.map((rate) => (
                  <div
                    key={rate.name}
                    data-anim="card"
                    className={`group relative rounded-xl border p-5 transition-all duration-300 hover:-translate-y-1 ${
                      rate.free
                        ? 'border-primary/30 bg-gradient-to-br from-primary/20 to-primary/10'
                        : 'border-border bg-card hover:border-primary/30 hover:shadow-lg hover:shadow-primary/10'
                    }`}
                  >
                    <div className="flex flex-col gap-1.5">
                      <span className="text-[0.92rem] font-semibold text-foreground">
                        {rate.name}
                      </span>
                      <span
                        className={`font-mono text-[1.6rem] font-semibold tabular-nums ${
                          rate.free ? 'text-primary' : 'text-foreground'
                        }`}
                      >
                        {rate.price}
                      </span>
                      <span className="text-[0.8rem] text-muted-foreground">{rate.per}</span>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-6 flex flex-wrap items-center gap-2.5 font-mono text-[0.88rem] text-muted-foreground">
                <Check className="h-4 w-4 flex-none text-primary" />
                1,000 marketing broadcasts ≈ ₹863 &nbsp;·&nbsp; 1,000 utility or authentication
                messages ≈ ₹115
              </div>
            </section>

            {/* Features */}
            <section data-anim="section" className="border-t border-border py-14 max-md:py-9">
              <p className="mb-2.5 font-mono text-[0.76rem] font-medium uppercase tracking-[0.09em] text-primary">
                Inside the panel
              </p>
              <h2 className="font-heading text-[clamp(1.5rem,2.8vw,2rem)] font-semibold leading-[1.2] tracking-[-0.01em]">
                Everything you need to run WhatsApp at scale
              </h2>
              <div className="mt-8 grid grid-cols-2 gap-4 max-md:grid-cols-1">
                {features.map((feature) => {
                  const Icon = feature.icon
                  return (
                    <div
                      key={feature.title || feature.label}
                      data-anim="item"
                      className="group flex items-center gap-4 rounded-xl border border-border bg-card p-4 transition-all duration-300 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-lg hover:shadow-primary/10"
                    >
                      <div className="flex h-10 w-10 flex-none items-center justify-center rounded-lg bg-primary/10 text-primary transition-colors duration-300 group-hover:bg-primary group-hover:text-primary-foreground">
                        <Icon className="h-5 w-5" />
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-foreground">
                          {feature.title || feature.label}
                        </span>
                        {feature.badge && (
                          <span className="inline-flex items-center rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 font-mono text-[0.65rem] uppercase tracking-[0.05em] text-amber-400">
                            {feature.badge}
                          </span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>

            {/* Pricing */}
            <section data-anim="section" className="border-t border-border py-14 max-md:py-9">
              <p className="mb-2.5 font-mono text-[0.76rem] font-medium uppercase tracking-[0.09em] text-primary">
                The plan
              </p>
              <h2 className="font-heading text-[clamp(1.5rem,2.8vw,2rem)] font-semibold leading-[1.2] tracking-[-0.01em]">
                ₹15,000 + GST, billed once a year
              </h2>
              <div className="mt-8 flex justify-center">
                <Card data-anim="card" className="w-full max-w-[420px] border-primary/20 bg-card shadow-lg shadow-primary/5">
                  <CardHeader className="relative items-center gap-3 pb-0 pt-8 text-center">
                    <span className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 font-mono text-[0.7rem] font-medium uppercase tracking-[0.08em] text-primary">
                      <Sparkles className="h-3 w-3" />
                      Annual plan
                    </span>
                    <CardTitle className="text-foreground">
                      <span className="flex items-baseline justify-center gap-1 font-heading text-[2.8rem] font-bold leading-none tracking-[-0.02em]">
                        <IndianRupee className="h-7 w-7" />
                        15,000
                        <span className="font-mono text-sm font-medium text-muted-foreground">
                          /year
                        </span>
                      </span>
                    </CardTitle>
                    <CardDescription className="max-w-[280px] text-base">
                      All the tools you need to run WhatsApp at scale
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="mt-6 space-y-4 px-7">
                    <div className="space-y-3">
                      {[
                        '5,000 contacts',
                        '50,000 messages',
                        'Broadcasting & automation',
                        'CRM & analytics',
                        'Visual flow builder',
                        'Integrations',
                      ].map((item) => (
                        <div key={item} className="flex items-center gap-3 text-sm">
                          <div className="flex h-5 w-5 flex-none items-center justify-center rounded-full bg-primary/10 text-primary">
                            <Check className="h-3 w-3" />
                          </div>
                          <span className="text-muted-foreground">{item}</span>
                        </div>
                      ))}
                    </div>
                    <div className="rounded-lg border border-border bg-muted/50 p-4">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Platform fee</span>
                        <span className="font-mono font-semibold text-foreground">₹15,000</span>
                      </div>
                      <div className="mt-2 flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">GST (18%)</span>
                        <span className="font-mono font-semibold text-foreground">₹2,700</span>
                      </div>
                      <div className="mt-3 flex items-center justify-between border-t border-border pt-3 text-base">
                        <span className="font-semibold text-foreground">Total payable</span>
                        <span className="font-mono font-bold text-primary">₹17,700</span>
                      </div>
                    </div>
                    <a
                      href="mailto:sales@yuvmedia.com"
                      className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-primary text-sm font-medium text-primary-foreground transition-all hover:bg-primary/80 active:translate-y-px"
                    >
                      <Mail className="h-4 w-4" />
                      Get started
                    </a>
                    <p className="text-center text-xs text-muted-foreground">
                      12 months validity. Per-message rates billed separately based on actual usage.
                    </p>
                  </CardContent>
                </Card>
              </div>
            </section>

            {/* Verification */}
            <section data-anim="section" className="border-t border-border py-14 max-md:py-9">
              <p className="mb-2.5 font-mono text-[0.76rem] font-medium uppercase tracking-[0.09em] text-primary">
                One-time setup
              </p>
              <h2 className="font-heading text-[clamp(1.5rem,2.8vw,2rem)] font-semibold leading-[1.2] tracking-[-0.01em]">
                Meta Business verification
              </h2>
              <p className="mt-3.5 max-w-[560px] text-base leading-relaxed text-muted-foreground">
                A one-time check Meta runs on the business behind the WhatsApp number. Charged only
                if it hasn&apos;t been completed already.
              </p>
              <div className="mt-6 grid grid-cols-2 gap-4 max-md:grid-cols-1">
                <div
                  data-anim="card"
                  className="rounded-xl border border-border bg-card p-6 transition-all duration-300 hover:shadow-lg hover:shadow-primary/10"
                >
                  <span className="mb-4 inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 font-mono text-[0.74rem] uppercase tracking-[0.06em] text-amber-400">
                    <Shield className="h-3.5 w-3.5" />
                    If not yet verified
                  </span>
                  <span className="flex items-baseline gap-1 font-mono text-[1.9rem] font-semibold text-foreground">
                    <IndianRupee className="h-6 w-6" />
                    5,000
                    <small className="ml-1 font-mono text-[0.95rem] font-medium text-muted-foreground">
                      +GST
                    </small>
                  </span>
                  <span className="mt-1 block font-mono text-[0.84rem] text-muted-foreground">
                    ₹5,900 total, one-time
                  </span>
                  <p className="mt-4 text-[0.92rem] leading-relaxed text-muted-foreground">
                    We guide you through the Meta Business verification process for your account.
                  </p>
                </div>
                <div
                  data-anim="card"
                  className="rounded-xl border border-primary/30 bg-gradient-to-br from-primary/20 to-primary/10 p-6 transition-all duration-300 hover:shadow-lg hover:shadow-primary/20"
                >
                  <span className="mb-4 inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/20 px-3 py-1 font-mono text-[0.74rem] uppercase tracking-[0.06em] text-primary">
                    <CheckCircle className="h-3.5 w-3.5" />
                    If already verified
                  </span>
                  <span className="flex items-baseline gap-1 font-mono text-[1.9rem] font-semibold text-foreground">
                    <IndianRupee className="h-6 w-6" />
                    0
                  </span>
                  <span className="mt-1 block font-mono text-[0.84rem] text-muted-foreground">
                    No extra charge
                  </span>
                  <p className="mt-4 text-[0.92rem] leading-relaxed text-muted-foreground">
                    Only the ₹17,700 annual plan applies — nothing else to pay upfront.
                  </p>
                </div>
              </div>
            </section>

            {/* Requirements */}
            <section data-anim="section" className="border-t border-border py-14 max-md:py-9">
              <p className="mb-2.5 font-mono text-[0.76rem] font-medium uppercase tracking-[0.09em] text-primary">
                Before we start
              </p>
              <h2 className="font-heading text-[clamp(1.5rem,2.8vw,2rem)] font-semibold leading-[1.2] tracking-[-0.01em]">
                What you&apos;ll need to provide
              </h2>
              <div className="mt-8 grid grid-cols-2 gap-4 max-md:grid-cols-1">
                {requirements.map((req) => (
                  <div
                    key={req}
                    data-anim="item"
                    className="group flex items-center gap-3 rounded-xl border border-border bg-card p-4 transition-all duration-300 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-lg hover:shadow-primary/10"
                  >
                    <div className="flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Check className="h-4 w-4" />
                    </div>
                    <span className="text-sm text-foreground">{req}</span>
                  </div>
                ))}
              </div>
            </section>

            {/* Renewal callout */}
            <div
              data-anim="renewal"
              className="my-2 mb-10 overflow-hidden rounded-xl border border-primary/20 bg-gradient-to-br from-primary/20 via-primary/10 to-primary/20 p-[1px]"
            >
              <div className="rounded-[calc(0.625rem-1px)] bg-card p-[22px_24px]">
                <div className="flex items-start gap-3.5">
                  <div className="flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-primary text-primary-foreground">
                    <Zap className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="m-0 text-[0.96rem] font-medium text-foreground">
                      <strong>Running low on credits?</strong> Once your 50,000 message credits
                      are used, top up anytime — renewed credits apply instantly so your campaigns
                      don&apos;t stop mid-broadcast.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <p className="mx-auto mb-10 max-w-[560px] text-center text-[0.78rem] text-muted-foreground">
              Per-message rates are set by Meta and may be revised periodically. Listed features
              and limits apply for the 12-month plan validity.
            </p>

            {/* Footer */}
            <footer
              data-anim="footer"
              className="relative mb-12 overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-br from-primary via-primary/90 to-primary/80 p-10 text-center max-md:px-6 max-md:py-8"
            >
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(255,255,255,0.1),transparent_60%)]" />
              <div className="relative z-10">
                <h2 className="font-heading text-[1.5rem] font-semibold text-primary-foreground">
                  Ready to start broadcasting?
                </h2>
                <p className="mt-2 font-mono text-[0.88rem] text-primary-foreground/70">
                  Get in touch and we&apos;ll have you set up within 24 hours.
                </p>
                <div className="mt-6 flex items-center justify-center gap-6 font-mono text-[0.88rem] max-sm:flex-col">
                  <a
                    className="inline-flex items-center gap-2 border-b border-primary-foreground/25 pb-0.5 text-primary-foreground/70 no-underline transition-all duration-200 hover:border-primary-foreground hover:text-primary-foreground"
                    href="mailto:sales@yuvmedia.com"
                  >
                    <Mail className="h-4 w-4" />
                    sales@yuvmedia.com
                  </a>
                  <span className="hidden text-primary-foreground/30 sm:inline">·</span>
                  <a
                    className="inline-flex items-center gap-2 border-b border-primary-foreground/25 pb-0.5 text-primary-foreground/70 no-underline transition-all duration-200 hover:border-primary-foreground hover:text-primary-foreground"
                    href="https://www.yuvmedia.com"
                    target="_blank"
                    rel="noopener"
                  >
                    <Globe className="h-4 w-4" />
                    www.yuvmedia.com
                  </a>
                </div>
              </div>
            </footer>

          </div>
        </div>
      </GsapAnimations>
    </>
  )
}
