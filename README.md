# VideoFetch Backend

Express.js API server for handling video analysis and downloads using yt-dlp and FFmpeg.

## 🚀 Quick Start

### Prerequisites

Ensure you have the following installed:
- Node.js 20+
- FFmpeg
- yt-dlp

```bash
# Check installations
node --version
ffmpeg -version
yt-dlp --version
```

### Installation

```bash
# 1. Install dependencies
npm install

# 2. Create environment file
cp .env.example .env.local

# 3. Edit .env.local with your settings (optional for development)
```

### Development

```bash
# Start development server with auto-reload
npm run dev

# Server runs on http://localhost:3001
```

### Production

```bash
# Build TypeScript
npm run build

# Start production server
npm start
```

## 📡 API Endpoints

### POST /api/analyze

Analyze a video URL and get metadata.

**Request:**
```bash
curl -X POST http://localhost:3001/api/analyze \
  -H "Content-Type: application/json" \
  -d '{"url": "https://youtube.com/watch?v=dQw4w9WgXcQ"}'
```

**Response:**
```json
{
  "title": "Never Gonna Give You Up",
  "thumbnail": "https://i.ytimg.com/...",
  "duration": 212,
  "formats": [
    {
      "id": "22+bestaudio[ext=m4a]/best",
      "resolution": "720p",
      "container": "mp4",
      "sizeMB": 45,
      "bitrate": "2500k",
      "isAudio": false
    }
  ]
}
```

### POST /api/download

Download a video in specified format and stream to client.

**Request:**
```bash
curl -X POST http://localhost:3001/api/download \
  -H "Content-Type: application/json" \
  -d '{"url": "https://youtube.com/watch?v=...", "formatId": "22+bestaudio[ext=m4a]/best"}' \
  --output video.mp4
```

**Response:**
- Binary file stream (Video or Audio)

## 🔧 Configuration

### Environment Variables

Create `.env.local` file:

```env
# Server
PORT=3001
NODE_ENV=production

# CORS - Allow requests from your Vercel frontend
CORS_ORIGIN=https://your-app.vercel.app

# Rate Limiting (per IP)
RATE_LIMIT_WINDOW_MS=900000    # 15 minutes
RATE_LIMIT_MAX_REQUESTS=10     # 10 requests per window

# Video Processing Limits
MAX_DURATION_SECONDS=3600      # 1 hour
MAX_FILE_SIZE_MB=2000          # 2GB
DOWNLOAD_TIMEOUT_MS=600000     # 10 minutes
```

## 🛠️ Deployment

### DigitalOcean Droplet

```bash
# 1. Create Ubuntu 22.04 Droplet ($4/month)

# 2. SSH into droplet
ssh root@your_droplet_ip

# 3. Update system
apt update && apt upgrade -y

# 4. Install dependencies
apt install -y \
  nodejs npm git \
  ffmpeg \
  python3-pip

pip install yt-dlp

# 5. Clone and setup
git clone https://github.com/yourusername/videofetch.git
cd videofetch/backend
npm install

# 6. Create production .env
cat > .env.local << EOF
PORT=3001
NODE_ENV=production
CORS_ORIGIN=https://your-app.vercel.app
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=10
MAX_DURATION_SECONDS=3600
MAX_FILE_SIZE_MB=2000
EOF

# 7. Build and start with PM2
npm run build
npm install -g pm2
pm2 start dist/server.js --name videofetch-backend
pm2 startup
pm2 save

# 8. Setup Nginx reverse proxy (optional)
# This allows you to use port 80/443 instead of 3001
```

### Docker Deployment

```bash
# Build image
docker build -t videofetch-backend .

# Run container
docker run \
  -p 3001:3001 \
  -e CORS_ORIGIN=https://your-app.vercel.app \
  videofetch-backend
```

### Environment Setup for Vercel Frontend

Once deployed, get your backend URL (e.g., `https://api.yourvps.com`) and set it in your Vercel project:

1. Go to Vercel Dashboard
2. Select your project
3. Settings → Environment Variables
4. Add: `NEXT_PUBLIC_API_URL=https://api.yourvps.com`
5. Redeploy

## 📊 Monitoring

```bash
# Check server health
curl http://localhost:3001/health

# View logs
pm2 logs videofetch-backend

# Monitor resource usage
pm2 monit
```

## 🔒 Security Notes

- **CORS**: Configured to only accept requests from your Vercel frontend
- **Rate Limiting**: Prevents abuse with 10 requests per 15 minutes per IP
- **File Size Limits**: Ensures large downloads don't overwhelm server
- **Temporary Files**: Automatically cleaned up after download
- **Input Validation**: All requests validated with Zod schemas

## 🐛 Troubleshooting

### Port 3001 already in use
```bash
# Find process using port
lsof -i :3001

# Kill process
kill -9 <PID>
```

### yt-dlp updates failing
```bash
# Update yt-dlp
pip install --upgrade yt-dlp

# Or use Homebrew
brew upgrade yt-dlp
```

### FFmpeg not working
```bash
# Test FFmpeg
ffmpeg -version

# Reinstall
brew install ffmpeg  # macOS
sudo apt install ffmpeg  # Linux
```

### CORS errors
- Check `CORS_ORIGIN` matches your Vercel domain exactly
- No trailing slash
- Must include protocol (https://)

## 📝 API Response Codes

| Code | Meaning |
|------|---------|
| 200 | Success |
| 400 | Invalid request (validation error) |
| 429 | Rate limit exceeded |
| 500 | Server error |
| 503 | Video processing tools not available |

## 🚀 Performance Tips

- Use a geographically close VPS to your users
- Enable Gzip compression in Nginx
- Use CDN for frontend (Vercel does this)
- Monitor disk space for temporary files
- Implement Redis for rate limiting in production

## 📚 Resources

- [Express.js Documentation](https://expressjs.com/)
- [yt-dlp Documentation](https://github.com/yt-dlp/yt-dlp)
- [FFmpeg Documentation](https://ffmpeg.org/documentation.html)
- [DigitalOcean Docs](https://docs.digitalocean.com/)

---

**Backend URL Format**: `https://api.yourdomain.com` or `https://your-vps-ip.com`
