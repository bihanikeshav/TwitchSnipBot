import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getUpcomingMatches, getLiveMatches, recordMatch } from '../api';

export default function Matches() {
  const queryClient = useQueryClient();
  const { data: upcoming = [], isLoading: loadingUpcoming } = useQuery({ queryKey: ['matches', 'upcoming'], queryFn: getUpcomingMatches });
  const { data: live = [], isLoading: loadingLive } = useQuery({ queryKey: ['matches', 'live'], queryFn: getLiveMatches, refetchInterval: 30000 });

  const recordMut = useMutation({
    mutationFn: recordMatch,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['recordings'] }),
  });

  return (
    <div>
      <h2 style={{ fontSize: '20px', marginBottom: '20px' }}>HLTV Matches</h2>

      <h3 style={{ fontSize: '16px', color: '#ff4444', marginBottom: '12px' }}>Live</h3>
      {loadingLive ? (
        <p style={{ color: '#adadb8' }}>Loading...</p>
      ) : live.length === 0 ? (
        <p style={{ color: '#adadb8', marginBottom: '24px' }}>No live matches right now.</p>
      ) : (
        <div style={{ marginBottom: '24px' }}>
          {live.map((match: any) => (
            <MatchCard key={match.id} match={match} onRecord={() => recordMut.mutate(match.id)} isLive />
          ))}
        </div>
      )}

      <h3 style={{ fontSize: '16px', color: '#adadb8', marginBottom: '12px' }}>Upcoming</h3>
      {loadingUpcoming ? (
        <p style={{ color: '#adadb8' }}>Loading...</p>
      ) : upcoming.length === 0 ? (
        <p style={{ color: '#adadb8' }}>No upcoming matches found.</p>
      ) : (
        <div>
          {upcoming.map((match: any) => (
            <MatchCard key={match.id} match={match} onRecord={() => recordMut.mutate(match.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

function MatchCard({ match, onRecord, isLive }: { match: any; onRecord: () => void; isLive?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', background: '#1f1f23', borderRadius: '4px', marginBottom: '8px' }}>
      <div>
        <div style={{ fontWeight: 600 }}>
          {match.team1} vs {match.team2}
          {isLive && <span style={{ color: '#ff4444', fontSize: '12px', marginLeft: '8px' }}>LIVE</span>}
        </div>
        <div style={{ fontSize: '12px', color: '#adadb8', marginTop: '2px' }}>
          {match.event} &middot; {match.format}
          {match.start_time && ` &middot; ${new Date(match.start_time * 1000).toLocaleString()}`}
        </div>
      </div>
      <button
        onClick={onRecord}
        style={{ background: '#9147ff', color: '#fff', border: 'none', padding: '6px 14px', borderRadius: '4px', fontSize: '13px', cursor: 'pointer' }}
      >
        Record
      </button>
    </div>
  );
}
