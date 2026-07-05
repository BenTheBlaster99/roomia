'use client'

import { useStudioStore } from '@/store/useStudioStore'

export default function CartDrawer() {
  const { cartOpen, setCartOpen, cart, removeFromCart, clearCart } = useStudioStore()
  const total = useStudioStore(s => s.cartTotal())

  if (!cartOpen) return null

  const quoteBody = cart
    .map(c => `${c.name} (${c.category}) x${c.quantity} — ${c.price.toLocaleString()} DZD`)
    .join('\n')

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        className="absolute inset-0 bg-zinc-900/20 backdrop-blur-sm"
        onClick={() => setCartOpen(false)}
      />
      <div className="relative w-full max-w-sm h-full bg-white border-l border-zinc-200 shadow-xl flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-200">
          <h2 className="font-bold text-zinc-900">Your Cart</h2>
          <button
            onClick={() => setCartOpen(false)}
            className="text-zinc-400 hover:text-zinc-800 text-xl leading-none"
            aria-label="Close cart"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {cart.length === 0 ? (
            <div className="text-center text-sm text-zinc-500 py-12">Your cart is empty</div>
          ) : (
            cart.map(item => (
              <div
                key={item.furnitureId}
                className="bg-stone-50 border border-zinc-200 rounded-xl p-3 flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-zinc-900 truncate">{item.name}</div>
                  <div className="text-xs text-zinc-500">{item.category}</div>
                  <div className="text-xs text-amber-700 font-bold mt-1">
                    {item.price.toLocaleString()} DZD
                    {item.quantity > 1 && (
                      <span className="text-zinc-500 font-normal"> × {item.quantity}</span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => removeFromCart(item.furnitureId)}
                  className="text-xs text-zinc-500 hover:text-red-600 transition-colors flex-shrink-0"
                >
                  Remove
                </button>
              </div>
            ))
          )}
        </div>

        {cart.length > 0 && (
          <div className="border-t border-zinc-200 p-4 space-y-3 bg-stone-50">
            <div className="flex justify-between items-center">
              <span className="text-sm font-bold text-zinc-900">Total</span>
              <span className="text-xl font-bold text-amber-600">{total.toLocaleString()} DZD</span>
            </div>
            <a
              href={`mailto:contact@roomia.dz?subject=Quote Request&body=${encodeURIComponent(quoteBody)}`}
              className="block w-full text-center py-3 bg-amber-500 text-white rounded-xl text-sm font-bold hover:bg-amber-600 transition-colors"
            >
              Request This Selection →
            </a>
            <button
              onClick={clearCart}
              className="w-full text-center py-2 text-xs text-zinc-500 hover:text-zinc-700 transition-colors"
            >
              Clear cart
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
