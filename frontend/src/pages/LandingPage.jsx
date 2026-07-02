import Navbar from '../components/Navbar'
import Hero from '../components/Hero'
import AgentCapabilities from '../components/AgentCapabilities'
import ProductGrid from '../components/ProductGrid'
import FeatureSection from '../components/FeatureSection'
import Footer from '../components/Footer'
import WelcomeBanner from '../components/WelcomeBanner'
import AppGrid from '../components/AppGrid'
import HiveDemo from '../components/HiveDemo'
import { useAuth } from '../contexts/AuthContext'

export default function LandingPage() {
  const { isAuthenticated } = useAuth()

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1">
        <Hero />
        {isAuthenticated && (
          <section id="apps" className="py-12 px-4 sm:px-6 lg:px-8 bg-gray-50 dark:bg-gray-950">
            <div className="max-w-7xl mx-auto">
              <WelcomeBanner />
              <AppGrid />
            </div>
          </section>
        )}
        <HiveDemo />
        <AgentCapabilities />
        <ProductGrid isAuthenticated={isAuthenticated} />
        <FeatureSection />
      </main>
      <Footer />
    </div>
  )
}
