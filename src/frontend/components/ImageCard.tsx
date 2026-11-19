type Props = { uri: string; name?: string; compact?: boolean };

export function ImageCard({ uri, name, compact }: Props) {
  return (
    <div style={{ margin: '10px 0' }}>
      <div className="imgrow">
        <div className="thumb">
          <img src={uri} alt={name || 'Attached chart'} />
        </div>
        {!compact && (
          <div className="secondary" style={{ fontSize: 'var(--fs-xs)' }}>
            Attached image{name ? ` · ${name}` : ''}
            <div className="imgcap">Sent as inline data URI — read by the research agent.</div>
          </div>
        )}
      </div>
    </div>
  );
}
