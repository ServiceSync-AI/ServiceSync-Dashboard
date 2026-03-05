# ServiceSync-Dashboard

**Service manager command center - real-time friction visualization**

Part of the ServiceSync Physical OS ecosystem - the "Decision Layer" that shows what's stuck, who owns it, and what needs action.

## Purpose

ServiceSync-Dashboard is the service manager's command center. It visualizes real-time operational friction, physical movement patterns, and AI-generated insights to help managers make decisions and eliminate "The Walking Tax".

## Key Features

- **Real-Time Friction**: Live updates as friction events occur
- **Physical Heatmaps**: Visualize "The Walk" patterns
- **Decision Layer**: "What's stuck, who owns it, what needs action"
- **Advisor Productivity**: Track efficiency metrics
- **AI Insights**: Automated recommendations
- **Friction Reports**: Daily/weekly operational intelligence

## Architecture

```
n8n Intelligence Engine (API)
    ↓
Supabase (Real-time subscriptions)
    ↓
Next.js Dashboard
    ↓
Service Manager View
```

## Dashboard Modules

### 1. Live Friction Feed
```
Real-time stream of friction events:
- 2:30 PM: Advisor Horn - "Backorder" detected at Parts Counter
- 2:28 PM: Tech Smith - "CDK Error" at Bay 3
- 2:25 PM: Advisor Jones - 5 min dwell time at Parts Counter
```

### 2. Physical Movement Heatmap
```
Visual heatmap showing:
- High traffic areas (red)
- Low traffic areas (green)
- "Walking Tax" hotspots
- Dwell time by location
```

### 3. Advisor Productivity
```
Metrics per advisor:
- ROs completed today
- Average RO time
- Friction events encountered
- Walking time vs. desk time
- Customer satisfaction score
```

### 4. AI Insights
```
Automated recommendations:
- "Parts Counter is a bottleneck (12 visits/hour)"
- "Advisor Horn spends 30% of time walking"
- "CDK errors spike at 2 PM daily"
- "Recommend: Add parts runner position"
```

## Tech Stack

- **Next.js 14** - React framework
- **TypeScript** - Type safety
- **Supabase** - Real-time database
- **Recharts** - Data visualization
- **Tailwind CSS** - Styling
- **Vercel** - Deployment

## Installation

### Development
```bash
# Clone this repo
git clone https://github.com/ServiceSync-AI/ServiceSync-Dashboard.git
cd ServiceSync-Dashboard

# Install dependencies
npm install

# Configure environment
cp .env.example .env.local
# Edit .env.local with Supabase credentials

# Run development server
npm run dev

# Open http://localhost:3000
```

### Production
```bash
# Build for production
npm run build

# Deploy to Vercel
vercel deploy
```

## Configuration

```env
# .env.local
NEXT_PUBLIC_SUPABASE_URL=https://your-supabase-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
```

## Development Status

🟢 **MEDIUM PRIORITY** - Needed for Q2 SaaS launch

### Phase 1: MVP (Q2)
- [ ] Build Next.js app scaffold
- [ ] Connect to Supabase
- [ ] Add real-time subscriptions
- [ ] Build friction feed module
- [ ] Build heatmap visualization

### Phase 2: Intelligence (Q2)
- [ ] Add advisor productivity metrics
- [ ] Integrate AI insights
- [ ] Build friction report generator
- [ ] Add export functionality

### Phase 3: SaaS Launch (Q3)
- [ ] Add user authentication
- [ ] Multi-dealership support
- [ ] Custom branding
- [ ] Mobile responsive design

## Data Sources

### Supabase Tables
- `friction_events` - Real-time friction detection
- `beacon_locations` - Physical movement data
- `transcription_results` - Audio transcripts
- `advisor_metrics` - Productivity calculations
- `ai_insights` - Generated recommendations

### Real-Time Subscriptions
```typescript
const subscription = supabase
  .channel('friction_events')
  .on('postgres_changes', 
    { event: 'INSERT', schema: 'public', table: 'friction_events' },
    (payload) => {
      // Update dashboard in real-time
    }
  )
  .subscribe()
```

## Example Dashboard View

```
┌─────────────────────────────────────────────────────┐
│ ServiceSync Dashboard - Shreveport Toyota          │
├─────────────────────────────────────────────────────┤
│                                                     │
│ 🔴 LIVE FRICTION FEED                              │
│ ├─ 2:30 PM: Advisor Horn - Backorder at Parts     │
│ ├─ 2:28 PM: Tech Smith - CDK Error at Bay 3       │
│ └─ 2:25 PM: Advisor Jones - 5 min at Parts        │
│                                                     │
│ 🗺️ PHYSICAL HEATMAP                                │
│ [Visual heatmap showing movement patterns]         │
│                                                     │
│ 📊 ADVISOR PRODUCTIVITY                            │
│ ├─ Horn: 8 ROs, 45 min avg, 3 friction events     │
│ ├─ Jones: 6 ROs, 52 min avg, 5 friction events    │
│ └─ Smith: 7 ROs, 48 min avg, 2 friction events    │
│                                                     │
│ 💡 AI INSIGHTS                                     │
│ ├─ Parts Counter bottleneck (12 visits/hour)      │
│ ├─ CDK errors spike at 2 PM daily                 │
│ └─ Recommend: Add parts runner position           │
│                                                     │
└─────────────────────────────────────────────────────┘
```

## Related Repositories

- [ServiceSync-Intelligence-Engine](https://github.com/ServiceSync-AI/ServiceSync-Data-Pipeline) - Core data processing
- [ServiceSync-Pipe](https://github.com/ServiceSync-AI/ServiceSync-Pipe) - Screenpipe plugin
- [ServiceSync-ShopSense](https://github.com/ServiceSync-AI/ServiceSync-ShopSense) - BLE beacon tracking
- [ServiceSync-Sidekick](https://github.com/ServiceSync-AI/ServiceSync-Sidekick) - Chrome extension

## License

MIT

## Contact

Frazier Horn - frazier@servicesync.io
