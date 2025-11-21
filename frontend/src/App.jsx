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
        // Auto-load campaigns for authenticated users
        await fetchCampaigns()
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
    setCampaigns([])
    setShowCampaigns(false)
  }
  const [selectedCampaign, setSelectedCampaign] = useState(null)
  const [donationAmount, setDonationAmount] = useState('')
  const [currentIdempotencyKey, setCurrentIdempotencyKey] = useState(null)

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
        // Auto-load campaigns after registration
        await fetchCampaigns()
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
    setCurrentIdempotencyKey(null)
  }

  // Generate a unique idempotency key for each donation attempt
  function generateIdempotencyKey() {
    // Format: user-{userId}-campaign-{campaignId}-{timestamp}-{random}
    const timestamp = Date.now()
    const random = Math.random().toString(36).substring(2, 15)
    return `${user.id}-${selectedCampaign.id}-${timestamp}-${random}`
  }

  async function handleDonate(isRetry = false) {
    if (!selectedCampaign || !donationAmount || parseFloat(donationAmount) <= 0) {
      setMessage('Please enter a valid donation amount')
      return
    }

    try {
      setMessage('Processing donation...')
      
      // Generate new key for fresh attempts, reuse existing key for retries
      let idempotencyKey
      if (isRetry && currentIdempotencyKey) {
        idempotencyKey = currentIdempotencyKey
        console.log('🔄 Retrying with existing idempotency key:', idempotencyKey.substring(0, 30) + '...')
      } else {
        idempotencyKey = generateIdempotencyKey()
        setCurrentIdempotencyKey(idempotencyKey)
        console.log('🔑 New donation attempt with idempotency key:', idempotencyKey.substring(0, 30) + '...')
      }
      
      const res = await fetch(`${apiBase}/api/donate`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
          'Idempotency-Key': idempotencyKey
        },
        body: JSON.stringify({ 
          campaignId: selectedCampaign.id,
          amount: parseFloat(donationAmount)
        })
      })
      
      const data = await res.json()
      
      if (res.ok) {
        if (data.replayed) {
          setMessage(`ℹ️ This donation was already processed. Donation ID: ${data.donation.donationId}`)
        } else {
          setMessage(`✅ Thank you! Your donation of $${donationAmount} has been received. Donation ID: ${data.donation.donationId}`)
        }
        
        // Clear the form and reset idempotency key for next donation
        setDonationAmount('')
        setCurrentIdempotencyKey(null)
        console.log('✅ Donation successful - idempotency key cleared for next donation')
        
        // Optionally refresh campaign to show updated amount
        await viewCampaignDetails(selectedCampaign.id)
      } else if (res.status === 401) {
        // Token expired, try to refresh
        setMessage('Session expired, refreshing...')
        await refreshAccessToken(refreshToken)
        // Retry donation after token refresh with SAME idempotency key
        await handleDonate(true)
      } else {
        setMessage(`❌ Donation failed: ${data.message || data.error}`)
        // Clear idempotency key on failure so user can retry with fresh key
        setCurrentIdempotencyKey(null)
      }
    } catch (error) {
      setMessage(`❌ Error processing donation: ${error.message}`)
      console.error('Donation error:', error)
      // Clear idempotency key on error so user can retry with fresh key
      setCurrentIdempotencyKey(null)
    }
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
          <button onClick={fetchCampaigns} style={{ padding: '8px 16px' }}>
            Refresh Campaigns
          </button>
        </div>
      )}

      <div style={{ marginTop: 12, padding: 12, backgroundColor: '#f5f5f5', borderRadius: 4, whiteSpace: 'pre-wrap' }}>
        {message || 'Ready'}
      </div>

      {selectedCampaign ? (
        <div style={{ marginTop: 30, maxWidth: 600 }}>
          <button onClick={backToCampaigns} style={{ marginBottom: 20, padding: '8px 16px', cursor: 'pointer' }}>
            ← Back to Campaigns
          </button>
          <div style={{ 
            border: '2px solid #2c5282', 
            borderRadius: 12, 
            padding: 24,
            backgroundColor: '#ffffff'
          }}>
            <h2 style={{ margin: '0 0 20px 0', color: '#2c5282' }}>{selectedCampaign.name}</h2>
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 14, color: '#666', marginBottom: 8 }}>Total Amount Raised</div>
              <div style={{ fontSize: 32, fontWeight: 'bold', color: '#2c5282' }}>
                ${parseFloat(selectedCampaign.total_amount_raised).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            </div>
            <div style={{ marginBottom: 20, fontSize: 14, color: '#999' }}>
              <div>Created: {new Date(selectedCampaign.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</div>
              <div style={{ marginTop: 4 }}>Last Updated: {new Date(selectedCampaign.updated_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</div>
            </div>
            
            <div style={{ 
              marginTop: 30, 
              padding: 20, 
              backgroundColor: '#f7fafc', 
              borderRadius: 8,
              border: '1px solid #e2e8f0'
            }}>
              <h3 style={{ margin: '0 0 15px 0', color: '#333' }}>Make a Donation</h3>
              <div style={{ marginBottom: 15 }}>
                <label style={{ display: 'block', marginBottom: 8, fontSize: 14, fontWeight: '500', color: '#4a5568' }}>
                  Donation Amount ($)
                </label>
                <input
                  type="number"
                  value={donationAmount}
                  onChange={e => setDonationAmount(e.target.value)}
                  placeholder="Enter amount"
                  min="1"
                  step="0.01"
                  style={{ 
                    width: '100%', 
                    padding: '10px 12px', 
                    fontSize: 16, 
                    border: '1px solid #cbd5e0',
                    borderRadius: 6,
                    boxSizing: 'border-box'
                  }}
                />
              </div>
              <button 
                onClick={handleDonate}
                disabled={!donationAmount || parseFloat(donationAmount) <= 0}
                style={{ 
                  width: '100%',
                  padding: '12px 24px',
                  fontSize: 16,
                  fontWeight: 'bold',
                  color: '#ffffff',
                  backgroundColor: donationAmount && parseFloat(donationAmount) > 0 ? '#2c5282' : '#a0aec0',
                  border: 'none',
                  borderRadius: 6,
                  cursor: donationAmount && parseFloat(donationAmount) > 0 ? 'pointer' : 'not-allowed',
                  transition: 'background-color 0.2s'
                }}
              >
                Donate ${donationAmount || '0.00'}
              </button>
            </div>
          </div>
        </div>
      ) : (
        showCampaigns && campaigns.length > 0 && (
          <div style={{ marginTop: 30 }}>
            <h3>Active Campaigns</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 20 }}>
              {campaigns.map(campaign => (
                <div key={campaign.id} style={{ 
                  border: '1px solid #ddd', 
                  borderRadius: 8, 
                  padding: 16,
                  backgroundColor: '#f9f9f9'
                }}>
                  <h4 style={{ margin: '0 0 10px 0', color: '#333' }}>{campaign.name}</h4>
                  <div style={{ marginTop: 10 }}>
                    <span style={{ fontSize: 18, fontWeight: 'bold', color: '#2c5282' }}>
                      ${parseFloat(campaign.total_amount_raised).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                    <span style={{ marginLeft: 10, fontSize: 14, color: '#666' }}>
                      raised
                    </span>
                  </div>
                  <div style={{ marginTop: 10, fontSize: 12, color: '#999' }}>
                    <div>Created: {new Date(campaign.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}</div>
                    <div style={{ marginTop: 4 }}>Updated: {new Date(campaign.updated_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}</div>
                  </div>
                  <button
                    onClick={() => viewCampaignDetails(campaign.id)}
                    style={{
                      marginTop: 15,
                      width: '100%',
                      padding: '8px 16px',
                      fontSize: 14,
                      fontWeight: '500',
                      color: '#ffffff',
                      backgroundColor: '#2c5282',
                      border: 'none',
                      borderRadius: 6,
                      cursor: 'pointer',
                      transition: 'background-color 0.2s'
                    }}
                  >
                    View Details & Donate
                  </button>
                </div>
              ))}
            </div>
          </div>
        )
      )}
    </div>
  )
}
