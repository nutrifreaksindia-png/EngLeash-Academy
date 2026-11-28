import React from 'react';
import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { VideoView } from '@livekit/react-native';
import type { VideoTrack } from 'livekit-client';

export type VideoTile = {
  key: string;
  label: string;
  track: VideoTrack | null;
  isHost?: boolean;
  speaking?: boolean;
  handRaised?: boolean;
  mirror?: boolean;
};

function Tile({ tile, width }: { tile: VideoTile; width: number }) {
  return (
    // Explicit height: with aspectRatio alone, a tile without video collapses to nothing.
    <View style={[styles.tile, { width, height: Math.round(width * 0.75) }, tile.speaking && styles.speaking]}>
      {tile.track ? (
        <VideoView style={styles.fill} videoTrack={tile.track} mirror={tile.mirror} />
      ) : (
        <View style={styles.off}>
          <Text style={styles.offText}>Camera off</Text>
        </View>
      )}
      <Text style={styles.label} numberOfLines={1}>
        {tile.handRaised ? '✋ ' : ''}
        {tile.label}
      </Text>
    </View>
  );
}

/**
 * Portrait classroom layout. The shared screen and the trainer stay fixed at the top so they remain
 * visible; everyone else is in a scrolling grid whose column count follows the head count and width.
 */
export function LiveVideoGrid({ tiles, screenShare }: { tiles: VideoTile[]; screenShare: VideoTrack | null }) {
  const { width } = useWindowDimensions();
  const pinned = tiles.filter((t) => t.isHost && t.track);
  const rest = tiles.filter((t) => !pinned.includes(t));
  const maxColumns = width >= 600 ? 3 : 2;
  const alone = rest.length === 1 && !pinned.length && !screenShare;
  const columns = alone || (rest.length <= 2 && !pinned.length && !screenShare) ? 1 : maxColumns;
  const gap = 8;
  const tileWidth = Math.floor((width - gap * (columns + 1)) / columns);

  return (
    <View style={styles.root}>
      {screenShare ? (
        <View style={styles.share} accessibilityLabel="Shared screen">
          <VideoView style={styles.fill} videoTrack={screenShare} objectFit="contain" />
        </View>
      ) : null}
      {pinned.length ? (
        <View style={styles.pinned}>
          {/* With a shared screen on top, the trainer shrinks so both fit. */}
          {pinned.slice(0, 2).map((t) => (
            <Tile key={t.key} tile={t} width={screenShare || pinned.length > 1 ? Math.floor((width - 24) / 2) : width - 16} />
          ))}
        </View>
      ) : null}
      <ScrollView style={styles.root} contentContainerStyle={[styles.grid, { gap, padding: gap }]}>
        {[...pinned.slice(2), ...rest].map((t) => (
          <Tile key={t.key} tile={t} width={tileWidth} />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  fill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  share: { width: '100%', aspectRatio: 16 / 10, backgroundColor: '#000' },
  pinned: { flexDirection: 'row', justifyContent: 'center', gap: 8, paddingHorizontal: 8, paddingTop: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center' },
  tile: { borderRadius: 10, overflow: 'hidden', backgroundColor: '#111827' },
  speaking: { borderWidth: 2, borderColor: '#22c55e' },
  off: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  offText: { color: '#94a3b8', fontSize: 13 },
  label: {
    position: 'absolute',
    left: 6,
    bottom: 6,
    maxWidth: '90%',
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
});
