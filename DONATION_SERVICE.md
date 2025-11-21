# Donation and Notification Services

## Architecture Overview

This implementation adds two new microservices to handle donations through a Kafka-based event-driven architecture:

### 1. Donation Service (`donation-service/`)
- **Port**: 6000
- **Endpoint**: `POST /api/donate`
- **Authentication**: JWT Bearer token required
- **Function**: 
  - Receives donation requests from authenticated users
  - Validates donation data (campaignId, amount)
  - Publishes donation events to Kafka `donation` topic
  - Returns confirmation with donation ID

### 2. Notification Service (`notification-service/`)
- **Type**: Kafka Consumer
- **Topic**: `donation`
- **Function**:
  - Consumes donation events from Kafka
  - Logs detailed donation information to console
  - Ready to be extended for email/SMS notifications

## Request Flow

```
User (Frontend) 
    ↓ POST /api/donate (with JWT)
Nginx 
    ↓ Routes to donation-service:6000
Donation Service
    ↓ Validates & Creates Event
Kafka (donation topic)
    ↓ Event Stream
Notification Service
    ↓ Consumes & Logs
Console Output (Future: Email/SMS)
```

## API Details

### POST /api/donate

**Headers:**
```
Authorization: Bearer <JWT_TOKEN>
Content-Type: application/json
Idempotency-Key: <UNIQUE_KEY>
```

**Idempotency Key Format:**
The frontend generates keys in format: `{userId}-{campaignId}-{timestamp}-{random}`
Example: `123-1-1732224000000-abc123xyz`

**Request Body:**
```json
{
  "campaignId": 1,
  "amount": 100.00
}
```

**Response (Success - 201 First Request):**
```json
{
  "success": true,
  "message": "Donation received successfully",
  "donation": {
    "donationId": "DON-1732224000000-abc123xyz",
    "campaignId": 1,
    "amount": 100.00,
    "currency": "USD",
    "timestamp": "2025-11-21T12:00:00.000Z"
  }
}
```

**Response (Success - 200 Duplicate Request):**
```json
{
  "success": true,
  "message": "Donation already processed (duplicate request prevented)",
  "replayed": true,
  "donation": {
    "donationId": "DON-1732224000000-abc123xyz",
    "campaignId": 1,
    "amount": 100.00,
    "currency": "USD",
    "timestamp": "2025-11-21T12:00:00.000Z"
  }
}
```

**Response (Error - 400 Missing Idempotency Key):**
```json
{
  "error": "Idempotency key required",
  "message": "Please provide an Idempotency-Key header to prevent duplicate donations"
}
```

**Response (Error - 401):**
```json
{
  "error": "Token expired",
  "message": "Your session has expired. Please login again or refresh your token."
}
```

## Kafka Event Structure

**Topic:** `donation`

**Message:**
```json
{
  "donationId": "DON-1732224000000-abc123xyz",
  "campaignId": 1,
  "userId": 123,
  "userEmail": "donor@example.com",
  "amount": 100.00,
  "currency": "USD",
  "timestamp": "2025-11-21T12:00:00.000Z",
  "status": "pending"
}
```

**Headers:**
- `event-type`: "donation.created"
- `source`: "donation-service"

## Docker Services Added

### docker-compose.yml

```yaml
donation-service:
  container_name: donation_service
  build:
    context: ./donation-service
  environment:
    - JWT_SECRET=${JWT_SECRET:-devsecret}
    - KAFKA_BROKER=kafka:9092
    - PORT=6000
  depends_on:
    kafka:
      condition: service_healthy
  restart: unless-stopped
  networks:
    - app-net

notification-service:
  container_name: notification_service
  build:
    context: ./notification-service
  environment:
    - KAFKA_BROKER=kafka:9092
  depends_on:
    kafka:
      condition: service_healthy
  restart: unless-stopped
  networks:
    - app-net
```

## Nginx Routing

Added route for donation endpoint:
```nginx
if ($request_uri ~* "^/api/donate") {
    proxy_pass http://donation-service:6000;
    break;
}
```

## Frontend Integration

Updated `handleDonate()` function in `frontend/src/App.jsx`:
- Sends authenticated POST request to `/api/donate`
- Includes JWT token in Authorization header
- Handles success/error responses
- Auto-refreshes token if expired
- Displays confirmation messages with donation ID

## Security Features

1. **JWT Authentication**: All donation requests require valid JWT token
2. **Idempotency Protection**: 
   - Each request requires unique `Idempotency-Key` header
   - Prevents duplicate donations from multiple button clicks
   - Keys cached for 24 hours (in-memory, Redis recommended for production)
   - Duplicate requests return cached response (200 status)
   - Same idempotency key used when retrying after token refresh
3. **Input Validation**: 
   - Campaign ID required
   - Amount must be > 0
   - Numeric validation
   - Idempotency key required
4. **Token Expiry Handling**: Frontend automatically refreshes expired tokens
5. **Error Handling**: Comprehensive error messages for debugging

## Idempotency Implementation

### How It Works

1. **Frontend generates unique key** per donation attempt:
   ```javascript
   // Format: userId-campaignId-timestamp-random
   const key = `${user.id}-${selectedCampaign.id}-${Date.now()}-${random()}`
   ```

2. **Backend checks cache** before processing:
   - If key exists: Return cached response (prevents duplicate)
   - If key new: Process donation and cache response

3. **Key retention**: 24 hours (TTL)
   - Automatic cleanup every hour
   - Production: Use Redis with TTL for scalability

4. **Retry scenarios**: 
   - Token refresh: Uses SAME idempotency key
   - Network error: User gets same key if they retry immediately
   - New attempt: Generates new key

### Benefits

- ✅ Prevents accidental duplicate donations
- ✅ Safe to retry failed requests
- ✅ Handles network issues gracefully
- ✅ Works across token refreshes
- ✅ No database queries for duplicate detection

## Testing

### 1. Start Services
```bash
docker-compose up -d
```

### 2. Login to get JWT token
```bash
curl -X POST http://localhost/api/login \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"password123"}'
```

### 3. Make a donation (with idempotency key)
```bash
IDEMPOTENCY_KEY="user-123-campaign-1-$(date +%s)-$(openssl rand -hex 8)"

curl -X POST http://localhost/api/donate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <YOUR_JWT_TOKEN>" \
  -H "Idempotency-Key: $IDEMPOTENCY_KEY" \
  -d '{"campaignId":1,"amount":50.00}'
```

### 3b. Test duplicate prevention (same idempotency key)
```bash
# Run the same command again - should return cached response
curl -X POST http://localhost/api/donate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <YOUR_JWT_TOKEN>" \
  -H "Idempotency-Key: $IDEMPOTENCY_KEY" \
  -d '{"campaignId":1,"amount":50.00}'
```

### 4. Check notification service logs
```bash
docker logs notification_service -f
```

## Console Output Example

When a donation is made, the notification service logs:
```
╔════════════════════════════════════════════════════════╗
║         💰 NEW DONATION RECEIVED!                     ║
╚════════════════════════════════════════════════════════╝

📋 Donation Details:
  • Donation ID: DON-1732224000000-abc123xyz
  • Campaign ID: 1
  • Amount: $100.00 USD
  • Donor Email: donor@example.com
  • User ID: 123
  • Status: pending
  • Timestamp: 2025-11-21T12:00:00.000Z

📊 Message Metadata:
  • Topic: donation
  • Partition: 0
  • Offset: 5
  • Event Type: donation.created
  • Source: donation-service

✉️  [Notification System]
  → Email notification would be sent to: donor@example.com
  → Thank you message for donation of $100.00
  → Campaign confirmation for Campaign #1
```

## Future Enhancements

1. **Redis Integration**: Move idempotency cache to Redis for production scalability
2. **Database Integration**: Store donations in PostgreSQL
3. **Email Service**: Send actual email notifications using SendGrid/SES
4. **SMS Notifications**: Add Twilio integration
5. **Payment Processing**: Integrate Stripe/PayPal
6. **Campaign Updates**: Update total_amount_raised in campaigns table
7. **Donation History**: API endpoint to fetch user's donation history
8. **Webhooks**: Notify campaign owners of new donations
9. **Analytics**: Track donation metrics in Grafana
10. **Distributed Idempotency**: Use Redis across multiple service instances
