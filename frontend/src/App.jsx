import React, { useState } from 'react'

// Behind nginx reverse proxy, use same-origin requests
const apiBase = ''

export default function App() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [token, setToken] = useState(null)
  const [message, setMessage] = useState('')
  const [campaigns, setCampaigns] = useState([])
  const [showCampaigns, setShowCampaigns] = useState(false)
  const [selectedCampaign, setSelectedCampaign] = useState(null)
  const [donationAmount, setDonationAmount] = useState('')

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
      // Fetch campaigns after successful login
      await fetchCampaigns()
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
        <button onClick={fetchCampaigns} disabled={!token}>Refresh Campaigns</button>
        <div style={{ marginTop: 12, whiteSpace: 'pre-wrap' }}>{message}</div>
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
