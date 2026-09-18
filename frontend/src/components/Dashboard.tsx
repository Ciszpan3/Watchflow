import {
  ArrowDownUp,
  BarChart3,
  Eye,
  Lightbulb,
  Menu,
  PlaySquare,
  Settings,
  Sparkles,
  TrendingUp,
  Users,
  X,
  Youtube
} from "lucide-react";
import { apiBaseUrl } from "../api";
import { formatDate, formatNumber, formatPercent, formatRelativeTime, formatTrend } from "../format";
import type { ChannelOverview, Insight, Video } from "../types";

export function Sidebar({ channel, open, onClose }: { channel: ChannelOverview | null; open: boolean; onClose: () => void }) {
  return (
    <>
      <button className={`sidebar-backdrop ${open ? "visible" : ""}`} onClick={onClose} aria-label="Close navigation" />
      <aside className={`sidebar ${open ? "open" : ""}`}>
        <div className="brand-row">
          <a className="brand" href="#overview" aria-label="Watchflow home">
            <span className="brand-mark"><Youtube aria-hidden="true" /></span>
            <span>Watchflow</span>
          </a>
          <button className="icon-button close-nav" onClick={onClose} aria-label="Close navigation"><X /></button>
        </div>
        <div className="channel-identity">
          {channel ? <img src={channel.channel.thumbnailUrl} alt="" /> : <span className="avatar-skeleton" />}
          <div>
            <strong>{channel?.channel.title ?? "Loading channel"}</strong>
            <span>{channel?.mode === "live" ? "Connected channel" : "Demo workspace"}</span>
          </div>
        </div>
        <nav aria-label="Main navigation">
          <a className="active" href="#overview" onClick={onClose}><BarChart3 /> <span>Overview</span></a>
          <a href="#videos" onClick={onClose}><PlaySquare /> <span>Videos</span></a>
          <a href="#insights" onClick={onClose}><Lightbulb /> <span>Insights</span></a>
          <a href="#settings" onClick={onClose}><Settings /> <span>Settings</span></a>
        </nav>
        <div className="connection-status">
          <span className={`status-dot ${channel?.mode === "live" ? "live" : "demo"}`} />
          <div>
            <strong>{channel?.mode === "live" ? "YouTube connected" : "Demo data active"}</strong>
            <span>{channel?.mode === "live" ? "Secure OAuth connection" : "Connect to use live data"}</span>
          </div>
        </div>
      </aside>
    </>
  );
}

export function MobileBar({ onMenu }: { onMenu: () => void }) {
  return (
    <div className="mobile-bar">
      <button className="icon-button" onClick={onMenu} aria-label="Open navigation"><Menu /></button>
      <div className="mobile-brand"><Youtube /> <strong>Watchflow</strong></div>
      <span className="status-dot demo" title="Demo data active" />
    </div>
  );
}

export function MetricCard({ label, value, trend, icon }: { label: string; value: string; trend: number; icon: "views" | "users" | "engagement" | "average" }) {
  const icons = { views: Eye, users: Users, engagement: TrendingUp, average: PlaySquare };
  const Icon = icons[icon];
  return (
    <article className="metric-card">
      <div className="metric-heading"><span>{label}</span><Icon aria-hidden="true" /></div>
      <strong>{value}</strong>
      <p><span className={trend >= 0 ? "positive" : "negative"}>{formatTrend(trend)}</span> vs previous period</p>
    </article>
  );
}

export function DashboardSkeleton() {
  return (
    <div className="dashboard-skeleton" aria-label="Loading dashboard">
      <div className="skeleton metrics-placeholder" />
      <div className="skeleton chart-placeholder" />
      <div className="skeleton list-placeholder" />
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <section className="empty-state" role="alert">
      <span className="empty-icon"><X /></span>
      <h2>Dashboard unavailable</h2>
      <p>{message}. Make sure the API is running and refresh this page.</p>
      <button className="button secondary" onClick={() => window.location.reload()}>Try again</button>
    </section>
  );
}

export function VideoList({ videos, sort, order, onSort, onOrder }: { videos: Video[]; sort: string; order: "asc" | "desc"; onSort: (sort: string) => void; onOrder: () => void }) {
  return (
    <section className="surface videos-panel" id="videos">
      <div className="section-heading">
        <div><span className="section-kicker">Content performance</span><h2>Recent videos</h2></div>
        <div className="sort-controls">
          <label><span className="sr-only">Sort videos</span><select value={sort} onChange={(event) => onSort(event.target.value)}><option value="opportunity">Opportunity</option><option value="views">Views</option><option value="engagement">Engagement</option><option value="recent">Published</option></select></label>
          <button className="icon-button bordered" onClick={onOrder} aria-label={`Sort ${order === "desc" ? "ascending" : "descending"}`}><ArrowDownUp /></button>
        </div>
      </div>
      {videos.length === 0 ? <div className="inline-empty"><PlaySquare /><strong>No videos yet</strong><span>Connect YouTube or run a sync to import uploads.</span></div> : (
        <div className="video-list">
          {videos.map((video) => (
            <article className="video-row" key={video.id}>
              <img src={video.thumbnailUrl} alt="" />
              <div className="video-copy"><h3>{video.title}</h3><p>{formatDate(video.publishedAt)} · {formatNumber(video.likes)} likes · {formatNumber(video.comments)} comments</p></div>
              <div className="video-stat"><strong>{formatNumber(video.views)}</strong><span>Views</span></div>
              <div className="video-stat"><strong>{formatPercent(video.engagementRate)}</strong><span>Engagement</span></div>
              <div className={`opportunity-score ${video.opportunityScore >= 85 ? "high" : ""}`}><strong>{video.opportunityScore}</strong><span>Opportunity</span></div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

export function InsightsPanel({ insights }: { insights: Insight[] }) {
  const iconMap = { opportunity: Sparkles, growth: TrendingUp, audience: Users, content: PlaySquare };
  return (
    <section className="surface insights-panel" id="insights">
      <div className="section-heading"><div><span className="section-kicker">Recommendations</span><h2>Creator insights</h2></div></div>
      <div className="insight-list">
        {insights.map((insight) => {
          const Icon = iconMap[insight.type];
          return <article className={`insight-item ${insight.type}`} key={insight.id}><div className="insight-icon"><Icon /></div><div><div className="insight-meta"><span>{insight.type}</span><span>{Math.round(insight.confidence * 100)}% confidence</span></div><h3>{insight.title}</h3><p>{insight.summary}</p><strong className="recommendation">{insight.recommendation}</strong></div></article>;
        })}
      </div>
    </section>
  );
}

export function WorkspaceHeader({ channel, range, onRange, onMenu, syncControl }: { channel: ChannelOverview; range: string; onRange: (range: string) => void; onMenu: () => void; syncControl: React.ReactNode }) {
  return (
    <header className="workspace-header">
      <button className="icon-button header-menu" onClick={onMenu} aria-label="Open navigation"><Menu /></button>
      <div className="workspace-title"><span className="eyebrow">Channel overview</span><h1>{channel.channel.title}</h1><p>Last synced {formatRelativeTime(channel.channel.lastSyncedAt)}</p></div>
      <div className="header-actions">
        <div className="segmented" aria-label="Analytics date range">{["7D", "28D", "90D"].map((option) => <button key={option} className={range === option ? "active" : ""} onClick={() => onRange(option)}>{option}</button>)}</div>
        <a className="button secondary" href={`${apiBaseUrl}/api/auth/google`}>Connect Google</a>
        {syncControl}
      </div>
    </header>
  );
}
