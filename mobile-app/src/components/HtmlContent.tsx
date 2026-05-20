import React, { useMemo } from 'react';
import { Linking, StyleProp, useWindowDimensions, View, ViewStyle } from 'react-native';
import RenderHTML, { MixedStyleRecord } from 'react-native-render-html';

const BODY_COLOR = '#334155';
const HEADING_COLOR = '#0f172a';
const LINK_COLOR = '#1a237e';

const MARKER_CHARS = '[\u2022\u2023\u25AA\u25E6\u25CF\u25CB\u25C6\u25C7◦▪•\\-*–—]';

/** Strip Word/list-style bullets from study HTML so headings match admin preview. */
export function sanitizeStudyMaterialHtml(html: string) {
  let out = String(html || '');
  out = out.replace(/display\s*:\s*list-item/gi, 'display:block');
  out = out.replace(/list-style(?:-type)?\s*:[^;"']+;?/gi, '');
  out = out.replace(/mso-list\s*:[^;"']+;?/gi, '');
  out = out.replace(new RegExp(`<p([^>]*)>\\s*${MARKER_CHARS}\\s*`, 'gi'), '<p$1>');
  out = out.replace(new RegExp(`<strong([^>]*)>\\s*${MARKER_CHARS}\\s*`, 'gi'), '<strong$1>');
  out = out.replace(/<(h[1-4])([^>]*)>([\s\S]*?)<\/\1>/gi, (_m, tag, attrs, inner) => {
    let body = inner
      .replace(new RegExp(`<span[^>]*>\\s*${MARKER_CHARS}\\s*<\\/span>`, 'gi'), '')
      .replace(new RegExp(`^\\s*${MARKER_CHARS}\\s*`, 'gm'), '')
      .replace(/^\s*\d+[.)]\s*/gm, '');
    body = body.replace(new RegExp(`>(\\s*${MARKER_CHARS}\\s*)<`, 'g'), '><');
    return `<${tag}${attrs}>${body}</${tag}>`;
  });
  return out;
}

function buildTagStyles(baseFontSize: number, studyContent = false): MixedStyleRecord {
  const lineHeight = Math.round(baseFontSize * 1.55);
  const headingSize = Math.round(baseFontSize * 1.15);
  const listPad = studyContent ? 18 : 20;
  const paraGap = studyContent ? 10 : 8;
  const listItemGap = studyContent ? 2 : 4;
  return {
    body: { color: BODY_COLOR, fontSize: baseFontSize, lineHeight },
    p: { marginTop: 8, marginBottom: paraGap, color: BODY_COLOR, fontSize: baseFontSize, lineHeight },
    div: { color: BODY_COLOR, fontSize: baseFontSize, lineHeight },
    ul: { marginTop: 8, marginBottom: paraGap, paddingLeft: listPad },
    ol: { marginTop: 8, marginBottom: paraGap, paddingLeft: listPad },
    li: { marginTop: 0, marginBottom: listItemGap, paddingLeft: 0, color: BODY_COLOR, fontSize: baseFontSize, lineHeight },
    h1: { fontSize: headingSize + 4, fontWeight: '700', color: HEADING_COLOR, marginTop: 12, marginBottom: 8 },
    h2: { fontSize: headingSize + 2, fontWeight: '700', color: HEADING_COLOR, marginTop: 12, marginBottom: 8 },
    h3: { fontSize: headingSize, fontWeight: '600', color: HEADING_COLOR, marginTop: 10, marginBottom: 6 },
    h4: { fontSize: headingSize, fontWeight: '600', color: HEADING_COLOR, marginTop: 10, marginBottom: 6 },
    strong: { fontWeight: '700' },
    b: { fontWeight: '700' },
    em: { fontStyle: 'italic' },
    i: { fontStyle: 'italic' },
    u: { textDecorationLine: 'underline' },
    a: { color: LINK_COLOR, textDecorationLine: 'underline' },
  };
}

export function htmlHasVisibleContent(html?: string | null) {
  if (!html || !String(html).trim()) return false;
  return String(html)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim().length > 0;
}

type HtmlContentProps = {
  html: string;
  style?: StyleProp<ViewStyle>;
  horizontalInset?: number;
  baseFontSize?: number;
  studyContent?: boolean;
};

export function HtmlContent({
  html,
  style,
  horizontalInset = 68,
  baseFontSize = 16,
  studyContent = false,
}: HtmlContentProps) {
  const { width } = useWindowDimensions();
  const contentWidth = Math.max(200, width - horizontalInset);
  const source = useMemo(() => {
    const raw = String(html);
    return { html: studyContent ? sanitizeStudyMaterialHtml(raw) : raw };
  }, [html, studyContent]);
  const tagStyles = useMemo(() => buildTagStyles(baseFontSize, studyContent), [baseFontSize, studyContent]);

  return (
    <View style={style}>
      <RenderHTML
        contentWidth={contentWidth}
        source={source}
        tagsStyles={tagStyles}
        baseStyle={tagStyles.body}
        enableExperimentalMarginCollapsing
        defaultTextProps={{ selectable: true }}
        renderersProps={{
          a: {
            onPress: (_event, href) => {
              if (href) void Linking.openURL(href);
            },
          },
        }}
      />
    </View>
  );
}
