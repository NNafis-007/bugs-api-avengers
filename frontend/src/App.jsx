import React, { useState, useEffect } from 'react'

// Behind nginx reverse proxy, use same-origin requests
const apiBase = ''

export default function App() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [accessToken, setAccessToken] = useState(null)
  const [refreshToken, setRefreshToken] = useState(null)
  const [user, setUser] = useState(null)
  const [message, setMessage] = useState('')
  const [campaigns, setCampaigns] = useState([])
  const [showCampaigns, setShowCampaigns] = useState(false)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [loading, setLoading] = useState(true)

  // Check for existing token on mount and auto-login
  useEffect(() => {
    console.log('🔍 Checking for existing tokens on page load...')
    console.log('🌐 API Base URL:', apiBase || 'same-origin')
    const storedAccessToken = localStorage.getItem('accessToken')
    const storedRefreshToken = localStorage.getItem('refreshToken')
    
    console.log('📦 localStorage contents:')
    console.log('  - accessToken:', storedAccessToken ? `${storedAccessToken.substring(0, 30)}...` : 'null')
    console.log('  - refreshToken:', storedRefreshToken ? `${storedRefreshToken.substring(0, 30)}...` : 'null')
    
    if (storedAccessToken) {
      console.log('✓ Found stored tokens - Attempting auto-login')
      setAccessToken(storedAccessToken)
      setRefreshToken(storedRefreshToken)
      // Verify token is still valid by fetching profile
      verifyAndLoadProfile(storedAccessToken, storedRefreshToken)
    } else {
      console.log('✗ No stored tokens found - Showing login form')
      setLoading(false)
    }
  }, [])

  // Verify token and load user profile
  async function verifyAndLoadProfile(token, refresh) {
    try {
      console.log('🔍 Verifying token with backend...')
      const res = await fetch(`${apiBase}/api/profile`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      
      console.log('📡 Backend response status:', res.status)
      
      if (res.ok) {
        const data = await res.json()
        console.log('✅ Token verified - Auto-login successful')
        console.log('User:', data.user)
        setUser(data.user)
        setIsAuthenticated(true)
        setMessage(`Welcome back, ${data.user.email}!`)
        // Auto-load products for authenticated users
        await fetchProducts()
      } else if (res.status === 401) {
        // Token expired, try to refresh
        const errorData = await res.json()
        console.log('⚠️ Token validation failed:', errorData)
        if (errorData.error === 'Token expired' && refresh) {
          console.log('🔄 Attempting to refresh token...')
          await refreshAccessToken(refresh)
        } else {
          // Invalid token, clear storage
          console.log('❌ Invalid token - clearing storage')
          handleLogout()
        }
      } else {
        console.log('❌ Unexpected response status:', res.status)
        const errorData = await res.json()
        console.log('Error data:', errorData)
        handleLogout()
      }
    } catch (err) {
      console.error('❌ Profile verification failed with error:', err)
      console.error('Error details:', err.message)
      handleLogout()
    } finally {
      setLoading(false)
    }
  }

  // Refresh access token using refresh token
  async function refreshAccessToken(refresh) {
    try {
      const res = await fetch(`${apiBase}/api/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: refresh })
      })

      if (res.ok) {
        const data = await res.json()
        const newAccessToken = data.accessToken
        console.log('🔄 Token refreshed:')
        console.log('New Access Token:', newAccessToken)
        setAccessToken(newAccessToken)
        localStorage.setItem('accessToken', newAccessToken)
        // Retry loading profile with new token
        await verifyAndLoadProfile(newAccessToken, refresh)
      } else {
        // Refresh token also expired
        handleLogout()
      }
    } catch (err) {
      console.error('Token refresh failed:', err)
      handleLogout()
    }
  }

  // Store tokens in localStorage and state
  function storeTokens(access, refresh, userData) {
    console.log('🔑 Storing tokens:')
    console.log('Access Token:', access)
    console.log('Refresh Token:', refresh)
    console.log('User:', userData)
    localStorage.setItem('accessToken', access)
    localStorage.setItem('refreshToken', refresh)
    console.log('✅ Tokens saved to localStorage')
    console.log('Verification - Reading back from localStorage:')
    console.log('  accessToken:', localStorage.getItem('accessToken') ? 'EXISTS' : 'MISSING')
    console.log('  refreshToken:', localStorage.getItem('refreshToken') ? 'EXISTS' : 'MISSING')
    setAccessToken(access)
    setRefreshToken(refresh)
    setUser(userData)
    setIsAuthenticated(true)
  }

  // Logout and clear tokens
  async function handleLogout() {
    if (accessToken) {
      try {
        await fetch(`${apiBase}/api/logout`, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`
          },
          body: JSON.stringify({ refreshToken })
        })
      } catch (err) {
        console.error('Logout request failed:', err)
      }
    }
    
    console.log('👋 Logging out - Clearing tokens')
    localStorage.removeItem('accessToken')
    localStorage.removeItem('refreshToken')
    setAccessToken(null)
    setRefreshToken(null)
    setUser(null)
    setIsAuthenticated(false)
    setMessage('Logged out successfully')
    setProducts([])
    setShowProducts(false)
  }
  const [selectedCampaign, setSelectedCampaign] = useState(null)
  const [donationAmount, setDonationAmount] = useState('')

  async function register() {
    try {
      const res = await fetch(`${apiBase}/api/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      })
      const data = await res.json()
      
      if (res.ok && data.accessToken) {
        console.log('📝 Registration successful - Setting tokens at login')
        storeTokens(data.accessToken, data.refreshToken, data.user)
        setMessage(`Registration successful! Welcome, ${data.user.email}`)
        setEmail('')
        setPassword('')
        // Auto-load products after registration
        await fetchProducts()
      } else {
        setMessage(data.error || JSON.stringify(data))
      }
    } catch (err) {
      setMessage('Registration failed: ' + err.message)
    }
  }

  async function login() {
    try {
      const res = await fetch(`${apiBase}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      })
      const data = await res.json()
      
      if (res.ok && data.accessToken) {
        console.log('🔐 Login successful - Setting tokens at login')
        storeTokens(data.accessToken, data.refreshToken, data.user)
        setMessage(`Logged in successfully! Welcome, ${data.user.email}`)
        setEmail('')
        setPassword('')
        // Fetch campaigns after successful login
        await fetchCampaigns()
      } else {
        setMessage(data.error || JSON.stringify(data))
      }
    } catch (err) {
      setMessage('Login failed: ' + err.message)
    }
  }

  async function profile() {
    try {
      const res = await fetch(`${apiBase}/api/profile`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      })
      const data = await res.json()
      
      if (res.ok) {
        setUser(data.user)
        setMessage('Profile loaded: ' + JSON.stringify(data.user, null, 2))
        console.log("JWT info " + JSON.stringify(data.user, null, 2))
      } else if (res.status === 401 && data.error === 'Token expired') {
        // Try to refresh token
        setMessage('Token expired, refreshing...')
        await refreshAccessToken(refreshToken)
      } else {
        setMessage(JSON.stringify(data))
      }
    } catch (err) {
      setMessage('Profile fetch failed: ' + err.message)
    }
  }

  async function fetchCampaigns() {
    try {
      const res = await fetch(`${apiBase}/api/campaigns`)
      const data = await res.json()
      if (data.campaigns) {
        setCampaigns(data.campaigns)
        setShowCampaigns(true)
        setMessage(`Loaded ${data.campaigns.length} campaigns`)
      }
    } catch (err) {
      setMessage('Failed to fetch campaigns: ' + err.message)
    }
  }

  async function viewCampaignDetails(campaignId) {
    try {
      const res = await fetch(`${apiBase}/api/campaigns/${campaignId}`)
      const data = await res.json()
      if (data.campaign) {
        setSelectedCampaign(data.campaign)
        setDonationAmount('')
        setMessage(`Viewing campaign: ${data.campaign.name}`)
      }
    } catch (err) {
      setMessage('Failed to fetch campaign details: ' + err.message)
    }
  }

  function backToCampaigns() {
    setSelectedCampaign(null)
    setDonationAmount('')
  }

  function handleDonate() {
    // Functionality to be implemented later
    setMessage(`Donation of $${donationAmount} will be processed (feature coming soon)`)
  }

  // Show loading state while checking authentication
  if (loading) {
    return (
      <div style={{ padding: 20, fontFamily: 'Arial, sans-serif' }}>
        <h2>Loading...</h2>
        <p>Checking authentication status...</p>
      </div>
    )
  }

  return (
    <div style={{ padding: 20, fontFamily: 'Arial, sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h2>Login App</h2>
        {isAuthenticated && user && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 15 }}>
            <span style={{ color: '#38a169', fontWeight: 'bold' }}>
              ✓ Logged in as: {user.email}
            </span>
            <button onClick={handleLogout} style={{ 
              backgroundColor: '#e53e3e', 
              color: 'white',
              border: 'none',
              padding: '8px 16px',
              borderRadius: 4,
              cursor: 'pointer'
            }}>
              Logout
            </button>
          </div>
        )}
      </div>

      {/* Show login form only if not authenticated */}
      {!isAuthenticated && (
        <div style={{ maxWidth: 800, marginBottom: 20 }}>
          <h3>Please Login or Register</h3>
          <input 
            value={email} 
            onChange={e => setEmail(e.target.value)} 
            placeholder="email OR Username!!" 
            style={{ marginBottom: 8, padding: 8, width: '100%', maxWidth: 400 }}
          />
          <br />
          <input 
            type="password" 
            value={password} 
            onChange={e => setPassword(e.target.value)} 
            placeholder="password" 
            style={{ marginBottom: 8, padding: 8, width: '100%', maxWidth: 400 }}
            onKeyPress={e => e.key === 'Enter' && login()}
          />
          <br />
          <button onClick={register} style={{ marginRight: 8, padding: '8px 16px' }}>Register</button>
          <button onClick={login} style={{ padding: '8px 16px' }}>Login</button>
        </div>
      )}

      {/* Show profile actions when authenticated */}
      {isAuthenticated && (
        <div style={{ maxWidth: 800, marginBottom: 20 }}>
          <h3>Your Profile</h3>
          <button onClick={profile} style={{ marginRight: 8, padding: '8px 16px' }}>
            View Profile Details
          </button>
          <button onClick={fetchProducts} style={{ padding: '8px 16px' }}>
            Refresh Products
          </button>
        </div>
      )}

      <div style={{ marginTop: 12, padding: 12, backgroundColor: '#f5f5f5', borderRadius: 4, whiteSpace: 'pre-wrap' }}>
        {message || 'Ready'}
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
