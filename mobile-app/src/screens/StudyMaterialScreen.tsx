import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { ScreenPageTitle } from '../components/ScreenPageTitle';
import { api } from '../api/client';

const BRAND_RED = '#c41e3a';
const BRAND_BLUE = '#1a237e';

type Block = {
  id: string;
  type: string;
  [key: string]: any;
};

type MaterialData = {
  id: number;
  title: string;
  description?: string | null;
  content_json: string;
};

type InlineSpan = {
  text?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: string;
  href?: string;
};

function parseBlocks(contentJson: string): Block[] {
  try {
    const parsed = JSON.parse(contentJson || '{}');
    if (!Array.isArray(parsed.blocks)) return [];
    return parsed.blocks;
  } catch {
    return [];
  }
}

function splitRows(raw: any): string[][] {
  if (Array.isArray(raw)) return raw.map((r) => (Array.isArray(r) ? r.map((c) => String(c || '')) : []));
  return [];
}

function stripHtml(html: string) {
  return String(html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Match admin: use structured spans unless HTML has real user text (not empty shell). */
function paragraphHasRenderableHtml(block: any): boolean {
  if (!block?.html || typeof block.html !== 'string') return false;
  return stripHtml(block.html).length > 0;
}

function applyCasing(text: string, mode?: string) {
  const t = String(text || '');
  if (mode === 'allCaps') return t.toUpperCase();
  if (mode === 'smallCaps') return t.toLowerCase();
  if (mode === 'titleCase') return t.toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase());
  if (mode === 'sentenceCase') {
    const s = t.toLowerCase().trim();
    if (!s) return '';
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  return t;
}

function normalizeSpans(block: any): InlineSpan[] {
  if (Array.isArray(block?.spans) && block.spans.length) return block.spans;
  return [{
    text: String(block?.text || ''),
    bold: !!block?.bold,
    italic: !!block?.italic,
    underline: !!block?.underline,
    color: block?.color || '#334155',
    href: '',
  }];
}

function InlineText({ spans, baseStyle }: { spans: InlineSpan[]; baseStyle: any }) {
  return (
    <Text style={baseStyle}>
      {spans.map((s, i) => (
        <Text
          key={`${i}-${s.text || ''}`}
          style={{
            color: s.color || '#334155',
            fontWeight: s.bold ? '700' : '400',
            fontStyle: s.italic ? 'italic' : 'normal',
            textDecorationLine: s.underline ? 'underline' : 'none',
          }}
          onPress={() => { if (s.href) Linking.openURL(s.href); }}
        >
          {s.text || ''}
        </Text>
      ))}
    </Text>
  );
}

function normalizeSpansWithCasing(block: any): InlineSpan[] {
  return normalizeSpans(block).map((s) => ({ ...s, text: applyCasing(String(s.text || ''), block?.casing) }));
}

const MAX_LIST_LEVEL = 8;

function clampListLevel(n: number) {
  return Math.min(MAX_LIST_LEVEL, Math.max(0, n));
}

function bulletGlyphForLevel(level: number) {
  const L = clampListLevel(level || 0);
  if (L <= 0) return '• ';
  if (L === 1) return '◦ ';
  return '▪ ';
}

function computeOrderedListLabels(items: any[]): string[] {
  const path: number[] = [];
  return (items || []).map((it) => {
    const L = clampListLevel(Number(it?.level) || 0);
    while (path.length > L + 1) path.pop();
    path.length = L + 1;
    path[L] = (path[L] || 0) + 1;
    return path.join('.');
  });
}

export default function StudyMaterialScreen({ route }: any) {
  const { materialId, materialTitle } = route.params || {};
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<MaterialData | null>(null);

  useEffect(() => {
    api.get(`/study-materials/${materialId}`)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [materialId]);

  const blocks = useMemo(() => parseBlocks(data?.content_json || ''), [data]);

  if (loading) {
    return (
      <View style={styles.pageRoot}>
        <ScreenPageTitle title={materialTitle || 'Study Material'} />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={BRAND_RED} />
        </View>
      </View>
    );
  }

  if (!data) {
    return (
      <View style={styles.pageRoot}>
        <ScreenPageTitle title={materialTitle || 'Study Material'} />
        <View style={styles.centered}>
          <Text style={styles.error}>Failed to load study material.</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.pageRoot}>
      <ScreenPageTitle title={data.title || materialTitle || 'Study Material'} />
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        {data.description ? <Text style={styles.description}>{data.description}</Text> : null}
        {blocks.map((b, idx) => {
          if (b.type === 'heading') {
            const size = b.level === 1 ? 26 : b.level === 2 ? 22 : 19;
            return (
              <InlineText
                key={b.id || `h-${idx}`}
                spans={normalizeSpansWithCasing(b)}
                baseStyle={[styles.heading, { fontSize: size, color: b.color || '#0f172a', textAlign: b.align || (b.level === 1 ? 'center' : 'left') }]}
              />
            );
          }
          if (b.type === 'paragraph') {
            if (paragraphHasRenderableHtml(b)) {
              return (
                <Text key={b.id || `p-${idx}`} style={styles.paragraph}>
                  {stripHtml(b.html)}
                </Text>
              );
            }
            return (
              <InlineText
                key={b.id || `p-${idx}`}
                spans={normalizeSpans(b)}
                baseStyle={[
                  styles.paragraph,
                  {
                    color: b.color || '#334155',
                    fontWeight: b.bold ? '700' : '400',
                    fontStyle: b.italic ? 'italic' : 'normal',
                    textDecorationLine: b.underline ? 'underline' : 'none',
                  },
                ]}
              />
            );
          }
          if (b.type === 'bulletList' || b.type === 'numberedList') {
            const listItems = b.items || [];
            const ordLabs = b.type === 'numberedList' ? computeOrderedListLabels(listItems) : [];
            return (
              <View key={b.id || `list-${idx}`} style={styles.listBlock}>
                {listItems.map((item: any, li: number) => {
                  const depth = clampListLevel(Number(item?.level) || 0);
                  const marker =
                    b.type === 'bulletList'
                      ? bulletGlyphForLevel(depth)
                      : `${ordLabs[li] ?? String(li + 1)}. `;
                  return (
                    <View
                      key={`${b.id || idx}-${li}`}
                      style={[styles.listRow, { marginLeft: depth * 14 }]}
                    >
                      <Text style={styles.listMarker}>{marker}</Text>
                      <View style={styles.listLine}>
                        <InlineText spans={normalizeSpans(item)} baseStyle={styles.paragraph} />
                      </View>
                    </View>
                  );
                })}
              </View>
            );
          }
          if (b.type === 'highlightedQuote') {
            return (
              <View key={b.id || `q-${idx}`} style={[styles.quoteCard, { alignSelf: 'stretch' }]}>
                <Text style={styles.quoteText}>{stripHtml(b.html || '')}</Text>
              </View>
            );
          }
          if (b.type === 'image_v2' || b.type === 'gif' || b.type === 'image') {
            const imageUrl = b.renderCache?.derivedUrl || b.asset?.originalUrl || b.url;
            const align = b.layout?.align || b.align || 'center';
            return (
              <View key={b.id || `img-${idx}`} style={[styles.mediaCard, align === 'left' ? { alignSelf: 'flex-start' } : align === 'right' ? { alignSelf: 'flex-end' } : { alignSelf: 'center' }]}>
                {imageUrl ? <Image source={{ uri: imageUrl }} style={styles.image} resizeMode={b.layout?.fitMode === 'contain' ? 'contain' : 'cover'} /> : null}
                {b.caption?.html ? <Text style={styles.caption}>{stripHtml(b.caption.html)}</Text> : b.caption ? <Text style={styles.caption}>{b.caption}</Text> : null}
              </View>
            );
          }
          if (b.type === 'imageCarousel') {
            return (
              <ScrollView key={b.id || `car-${idx}`} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.carouselRow}>
                {(b.items || []).map((item: any, i: number) => (
                  <View key={`${b.id || idx}-${i}`} style={styles.carouselCard}>
                    {item.url ? <Image source={{ uri: item.url }} style={styles.carouselImage} resizeMode="cover" /> : null}
                    {item.caption ? <Text style={styles.caption}>{item.caption}</Text> : null}
                  </View>
                ))}
              </ScrollView>
            );
          }
          if (b.type === 'table') {
            const rows = splitRows(b.rows);
            return (
              <View key={b.id || `t-${idx}`} style={styles.tableWrap}>
                {rows.map((row, rIdx) => (
                  <View key={`${idx}-r-${rIdx}`} style={styles.tableRow}>
                    {row.map((cell, cIdx) => (
                      <Text key={`${idx}-${rIdx}-${cIdx}`} style={[styles.tableCell, rIdx === 0 ? styles.tableHeader : null]}>{cell}</Text>
                    ))}
                  </View>
                ))}
              </View>
            );
          }
          if (b.type === 'pdfAttachment') {
            return (
              <TouchableOpacity
                key={b.id || `pdf-${idx}`}
                style={[styles.linkCard, b.align === 'left' ? { alignSelf: 'flex-start' } : b.align === 'center' ? { alignSelf: 'center' } : { alignSelf: 'flex-end' }]}
                onPress={() => b.url && Linking.openURL(b.url)}
              >
                <Text style={styles.linkText}>{b.label || 'Download PDF'}</Text>
              </TouchableOpacity>
            );
          }
          if (b.type === 'audioAttachment') {
            return (
              <TouchableOpacity key={b.id || `aud-${idx}`} style={styles.linkCard} onPress={() => b.url && Linking.openURL(b.url)}>
                <Text style={styles.linkText}>{b.title || 'Open Audio File'}</Text>
              </TouchableOpacity>
            );
          }
          return <View key={b.id || `d-${idx}`} style={styles.divider} />;
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  pageRoot: { flex: 1, backgroundColor: '#f5f5f5' },
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  content: { padding: 16, paddingBottom: 36, gap: 10 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  error: { color: '#c62828', fontSize: 16 },
  description: { color: '#475569', fontSize: 14, marginBottom: 6 },
  heading: { color: '#0f172a', fontWeight: '700', marginTop: 8 },
  listBlock: { alignSelf: 'stretch', marginBottom: 8, gap: 6 },
  listRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  listMarker: { color: '#334155', fontSize: 15, lineHeight: 22, minWidth: 22 },
  listLine: { flex: 1 },
  paragraph: { fontSize: 15, lineHeight: 22, marginTop: 4 },
  mediaCard: { backgroundColor: '#fff', borderRadius: 12, padding: 8, borderWidth: 1, borderColor: '#e2e8f0' },
  image: { width: '100%', height: 210, borderRadius: 10, backgroundColor: '#e2e8f0' },
  caption: { marginTop: 6, fontSize: 12, color: '#64748b' },
  carouselRow: { gap: 10, paddingVertical: 2 },
  carouselCard: { width: 280, backgroundColor: '#fff', borderRadius: 12, padding: 8, borderWidth: 1, borderColor: '#e2e8f0' },
  carouselImage: { width: '100%', height: 170, borderRadius: 10, backgroundColor: '#e2e8f0' },
  tableWrap: { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 10, overflow: 'hidden', backgroundColor: '#fff' },
  tableRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#e2e8f0' },
  tableCell: { flex: 1, padding: 8, color: '#334155', fontSize: 13 },
  tableHeader: { fontWeight: '700', color: BRAND_BLUE, backgroundColor: '#eef2ff' },
  linkCard: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#dbe3f0', borderRadius: 10, padding: 12 },
  linkText: { color: BRAND_BLUE, fontWeight: '700' },
  divider: { height: 1, backgroundColor: '#e2e8f0', marginVertical: 6 },
  quoteCard: {
    backgroundColor: '#eff6ff',
    borderLeftWidth: 4,
    borderLeftColor: BRAND_BLUE,
    borderRadius: 10,
    padding: 12,
  },
  quoteText: { color: BRAND_BLUE, fontSize: 15, lineHeight: 22, fontStyle: 'italic', fontWeight: '600' },
});
