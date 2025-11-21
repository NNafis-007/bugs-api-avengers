import React, { useState } from 'react'

// Behind nginx reverse proxy, use same-origin requests
const apiBase = ''

export default function App() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [token, setToken] = useState(null)
  const [message, setMessage] = useState('')
  const [products, setProducts] = useState([])
  const [showProducts, setShowProducts] = useState(false)

  async function register() {
    const res = await fetch(`${apiBase}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    })
    const data = await res.json()
    setMessage(JSON.stringify(data))
  }

  async function login() {
    const res = await fetch(`${apiBase}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    })
    const data = await res.json()
    if (data.token) {
      setToken(data.token)
      setMessage('Logged in successfully!')
      // Fetch products after successful login
      await fetchProducts()
    } else {
      setMessage(JSON.stringify(data))
    }
  }

  async function profile() {
    const res = await fetch(`${apiBase}/api/profile`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    const data = await res.json()
    setMessage(JSON.stringify(data))
  }

  async function fetchProducts() {
    try {
      const res = await fetch(`${apiBase}/api/products`)
      const data = await res.json()
      if (data.products) {
        setProducts(data.products)
        setShowProducts(true)
        setMessage(`Loaded ${data.products.length} products`)
      }
    } catch (err) {
      setMessage('Failed to fetch products: ' + err.message)
    }
  }

  return (
    <div style={{ padding: 20, fontFamily: 'Arial, sans-serif' }}>
      <h2>Login App</h2>
      <div style={{ maxWidth: 800 }}>
        <input value={email} onChange={e => setEmail(e.target.value)} placeholder="email OR Username!!" />
        <br />
        <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="password" />
        <br />
        <button onClick={register}>Register</button>
        <button onClick={login}>Login</button>
        <button onClick={profile} disabled={!token}>Profile</button>
        <button onClick={fetchProducts} disabled={!token}>Refresh Products</button>
        <div style={{ marginTop: 12, whiteSpace: 'pre-wrap' }}>{message}</div>
      </div>

      {showProducts && products.length > 0 && (
        <div style={{ marginTop: 30 }}>
          <h3>Available Products</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 20 }}>
            {products.map(product => (
              <div key={product.id} style={{ 
                border: '1px solid #ddd', 
                borderRadius: 8, 
                padding: 16,
                backgroundColor: '#f9f9f9'
              }}>
                <h4 style={{ margin: '0 0 10px 0', color: '#333' }}>{product.name}</h4>
                <p style={{ margin: '5px 0', fontSize: 14, color: '#666' }}>{product.description}</p>
                <div style={{ marginTop: 10 }}>
                  <span style={{ fontSize: 18, fontWeight: 'bold', color: '#2c5282' }}>
                    ${parseFloat(product.price).toFixed(2)}
                  </span>
                  <span style={{ marginLeft: 15, fontSize: 14, color: product.stock > 0 ? '#38a169' : '#e53e3e' }}>
                    {product.stock > 0 ? `${product.stock} in stock` : 'Out of stock'}
                  </span>
                </div>
                <div style={{ marginTop: 8, fontSize: 12, color: '#999' }}>
                  Category: {product.category}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
