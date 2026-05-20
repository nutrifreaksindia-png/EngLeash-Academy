import React, { useMemo } from 'react';
import { Linking, StyleProp, useWindowDimensions, View, ViewStyle } from 'react-native';
import RenderHTML, { MixedStyleRecord } from 'react-native-render-html';

const BODY_COLOR = '#334155';
const HEADING_COLOR = '#0f172a';
const LINK_COLOR = '#1a237e';

/** Strip bullets from headings in pasted paragraph HTML so they match admin heading blocks. */
export function sanitizeStudyMaterialHtml(html: string) {
  return String(html || '').replace(/<(h[1-4])([^>]*)>([\s\S]*?)<\/\1>/gi, (_m, tag, attrs, inner) => {
    let body = inner
      .replace(/<span[^>]*>\s*[\u2022◦▪•\-–—*]+\s*<\/span>/gi, '')
      .replace(/^\s*[\u2022◦▪•\-–—*]+\s*/gm, '')
      .replace(/^\s*\d+[.)]\s*/gm, '');
    body = body.replace(/>(\s*[\u2022◦▪•\-–—*]+\s*)</g, '><');
    return `<${tag}${attrs}>${body}</${tag}>`;
  });
}

function buildTagStyles(baseFontSize: number, studyContent = false): MixedStyleRecord {
  const lineHeight = Math.round(baseFontSize * 1.55);
  const headingSize = Math.round(baseFontSize * 1.15);
  const listPad = studyContent ? 18 : 20;
  const blockGap = studyContent ? 6 : 8;
  return {
    body: { color: BODY_COLOR, fontSize: baseFontSize, lineHeight },
    p: { marginTop: blockGap, marginBottom: blockGap, color: BODY_COLOR, fontSize: baseFontSize, lineHeight },
    div: { color: BODY_COLOR, fontSize: baseFontSize, lineHeight },
    ul: { marginTop: blockGap, marginBottom: blockGap, paddingLeft: listPad },
    ol: { marginTop: blockGap, marginBottom: blockGap, paddingLeft: listPad },
    li: { marginBottom: studyContent ? 2 : 4, color: BODY_COLOR, fontSize: baseFontSize, lineHeight },
    h1: { fontSize: headingSize + 4, fontWeight: '700', color: HEADING_COLOR, marginTop: 12, marginBottom: 6 },
    h2: { fontSize: headingSize + 2, fontWeight: '700', color: HEADING_COLOR, marginTop: 12, marginBottom: 6 },
    h3: { fontSize: headingSize, fontWeight: '600', color: HEADING_COLOR, marginTop: 12, marginBottom: 6 },
    h4: { fontSize: headingSize, fontWeight: '600', color: HEADING_COLOR, marginTop: 12, marginBottom: 6 },
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
  /** Horizontal inset from screen edges (default matches course detail block padding). */
  horizontalInset?: number;
  /** Base body font size (default 16 for course specs, 17 for study content). */
  baseFontSize?: number;
  /** Study material / worksheet rich paragraphs — tighter lists, no heading bullets. */
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
