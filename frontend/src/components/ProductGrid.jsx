import ProductCard from './ProductCard'
import { getProductGridApps } from '@shizuha/ui'

// Get apps from the shared registry (Single Source of Truth)
const SHIZUHA_PRODUCTS = getProductGridApps()

export default function ProductGrid({ isAuthenticated = false }) {
  return (
    <section id="products" className="py-20 px-4 sm:px-6 lg:px-8 bg-gray-50 dark:bg-gray-950">
      <div className="max-w-7xl mx-auto">
        {/* Section header */}
        <div className="text-center mb-16">
          <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-white mb-4">
            Everything you need, unified
          </h2>
          <p className="text-lg text-gray-600 dark:text-gray-400 max-w-2xl mx-auto">
            A complete suite of productivity tools that work together seamlessly with a single sign-on.
          </p>
        </div>

        {/* Product grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-stagger">
          {SHIZUHA_PRODUCTS.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              isAuthenticated={isAuthenticated}
            />
          ))}
        </div>
      </div>
    </section>
  )
}

export { SHIZUHA_PRODUCTS }
