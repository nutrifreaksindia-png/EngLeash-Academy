import React, { useMemo, useRef, useState } from 'react';
import {
  LayoutRectangle,
  PanResponder,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

const BRAND_BLUE = '#1a237e';

type Pair = { left_text?: string; right_text?: string };

type Props = {
  pairs: Pair[];
  matches: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
};

export default function MatchingDragBoard({ pairs, matches, onChange }: Props) {
  const lefts = useMemo(() => pairs.map((p) => String(p.left_text || '')), [pairs]);
  const rights = useMemo(() => {
    const values = pairs.map((p) => String(p.right_text || ''));
    // Stable shuffle by original index so pool order isn't always left-aligned.
    return values
      .map((text, i) => ({ text, i }))
      .sort((a, b) => ((a.i * 7 + 3) % values.length) - ((b.i * 7 + 3) % values.length))
      .map((x) => x.text);
  }, [pairs]);

  const usedRights = useMemo(() => new Set(Object.values(matches || {})), [matches]);
  const available = rights.filter((r) => !usedRights.has(r));

  const dropLayouts = useRef<Record<string, LayoutRectangle>>({});
  const boardOffset = useRef({ x: 0, y: 0 });
  const boardRef = useRef<View>(null);
  const [dragging, setDragging] = useState<{ text: string; x: number; y: number } | null>(null);

  const assign = (left: string, right: string) => {
    const next = { ...(matches || {}) };
    // Remove this right from any other left first.
    for (const k of Object.keys(next)) {
      if (next[k] === right) delete next[k];
    }
    next[left] = right;
    onChange(next);
  };

  const clearLeft = (left: string) => {
    const next = { ...(matches || {}) };
    delete next[left];
    onChange(next);
  };

  const findDropTarget = (pageX: number, pageY: number) => {
    for (const left of lefts) {
      const layout = dropLayouts.current[left];
      if (!layout) continue;
      const x = boardOffset.current.x + layout.x;
      const y = boardOffset.current.y + layout.y;
      if (pageX >= x && pageX <= x + layout.width && pageY >= y && pageY <= y + layout.height) {
        return left;
      }
    }
    return null;
  };

  const makePan = (text: string) =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        boardRef.current?.measureInWindow((x, y) => {
          boardOffset.current = { x, y };
        });
        setDragging({
          text,
          x: evt.nativeEvent.pageX - boardOffset.current.x - 48,
          y: evt.nativeEvent.pageY - boardOffset.current.y - 22,
        });
      },
      onPanResponderMove: (evt) => {
        setDragging({
          text,
          x: evt.nativeEvent.pageX - boardOffset.current.x - 48,
          y: evt.nativeEvent.pageY - boardOffset.current.y - 22,
        });
      },
      onPanResponderRelease: (evt) => {
        boardRef.current?.measureInWindow((x, y) => {
          boardOffset.current = { x, y };
        });
        const left = findDropTarget(evt.nativeEvent.pageX, evt.nativeEvent.pageY);
        if (left) assign(left, text);
        setDragging(null);
      },
      onPanResponderTerminate: () => setDragging(null),
    });

  return (
    <View
      ref={boardRef}
      style={styles.board}
      onLayout={() => {
        boardRef.current?.measureInWindow((x, y) => {
          boardOffset.current = { x, y };
        });
      }}
    >
      <Text style={styles.hint}>Drag answers onto the matching prompts</Text>

      {lefts.map((left, leftIdx) => {
        const matched = matches?.[left];
        return (
          <View
            key={`left-${leftIdx}-${left}`}
            style={[styles.dropZone, matched ? styles.dropZoneFilled : null]}
            onLayout={(e) => {
              dropLayouts.current[left] = e.nativeEvent.layout;
            }}
          >
            <Text style={styles.dropPrompt}>{left}</Text>
            {matched ? (
              <TouchableOpacity style={styles.matchedChip} onPress={() => clearLeft(left)}>
                <Text style={styles.matchedChipText}>{matched}</Text>
                <Text style={styles.clearX}>✕</Text>
              </TouchableOpacity>
            ) : (
              <Text style={styles.dropPlaceholder}>Drop answer here</Text>
            )}
          </View>
        );
      })}

      <Text style={styles.poolLabel}>Answers</Text>
      <View style={styles.pool}>
        {available.map((text, poolIdx) => {
          const pan = makePan(text);
          return (
            <View key={`pool-${poolIdx}-${text}`} {...pan.panHandlers} style={styles.poolChip}>
              <Text style={styles.poolChipText}>{text}</Text>
            </View>
          );
        })}
        {available.length === 0 ? (
          <Text style={styles.poolEmpty}>All answers placed — tap a match to undo</Text>
        ) : null}
      </View>

      {dragging ? (
        <View pointerEvents="none" style={[styles.ghost, { left: dragging.x, top: dragging.y }]}>
          <Text style={styles.ghostText}>{dragging.text}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  board: {
    marginTop: 4,
  },
  hint: {
    fontSize: 13,
    color: '#64748b',
    marginBottom: 12,
  },
  dropZone: {
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: '#dbe3f4',
    borderStyle: 'dashed',
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    minHeight: 84,
  },
  dropZoneFilled: {
    borderStyle: 'solid',
    borderColor: BRAND_BLUE,
    backgroundColor: '#eef2ff',
  },
  dropPrompt: {
    fontSize: 15,
    fontWeight: '700',
    color: BRAND_BLUE,
    marginBottom: 8,
  },
  dropPlaceholder: {
    fontSize: 13,
    color: '#94a3b8',
    fontStyle: 'italic',
  },
  matchedChip: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: BRAND_BLUE,
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  matchedChipText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
    maxWidth: 220,
  },
  clearX: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 12,
  },
  poolLabel: {
    marginTop: 8,
    marginBottom: 8,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: '#94a3b8',
  },
  pool: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  poolChip: {
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: '#cbd5e1',
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  poolChipText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
  },
  poolEmpty: {
    fontSize: 13,
    color: '#94a3b8',
  },
  ghost: {
    position: 'absolute',
    zIndex: 50,
    backgroundColor: BRAND_BLUE,
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: 14,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  ghostText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 14,
  },
});
