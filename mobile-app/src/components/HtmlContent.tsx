import React, { useMemo } from 'react';
import { Linking, StyleProp, useWindowDimensions, View, ViewStyle } from 'react-native';
import RenderHTML, { MixedStyleRecord } from 'react-native-render-html';

const BODY_COLOR = '#334155';
const HEADING_COLOR = '#0f172a';
const LINK_COLOR = '#1a237e';

/** Matches web-admin `.courseViewSpecs` typography for WYSIWYG course specifications. */
const SPECS_TAG_STYLES: MixedStyleRecord = {
  body: { color: BODY_COLOR, fontSize: 16, lineHeight: 24.8 },
  p: { marginTop: 8, marginBottom: 8, color: BODY_COLOR, fontSize: 16, lineHeight: 24.8 },
  div: { color: BODY_COLOR, fontSize: 16, lineHeight: 24.8 },
  ul: { marginTop: 8, marginBottom: 8, paddingLeft: 20 },
  ol: { marginTop: 8, marginBottom: 8, paddingLeft: 20 },
  li: { marginBottom: 4, color: BODY_COLOR, fontSize: 16, lineHeight: 24.8 },
  h1: { fontSize: 16, fontWeight: '600', color: HEADING_COLOR, marginTop: 12, marginBottom: 6 },
  h2: { fontSize: 16, fontWeight: '600', color: HEADING_COLOR, marginTop: 12, marginBottom: 6 },
  h3: { fontSize: 16, fontWeight: '600', color: HEADING_COLOR, marginTop: 12, marginBottom: 6 },
  h4: { fontSize: 16, fontWeight: '600', color: HEADING_COLOR, marginTop: 12, marginBottom: 6 },
  strong: { fontWeight: '700' },
  b: { fontWeight: '700' },
  em: { fontStyle: 'italic' },
  i: { fontStyle: 'italic' },
  u: { textDecorationLine: 'underline' },
  a: { color: LINK_COLOR, textDecorationLine: 'underline' },
};

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
};

export function HtmlContent({ html, style, horizontalInset = 68 }: HtmlContentProps) {
  const { width } = useWindowDimensions();
  const contentWidth = Math.max(200, width - horizontalInset);
  const source = useMemo(() => ({ html: String(html) }), [html]);

  return (
    <View style={style}>
      <RenderHTML
        contentWidth={contentWidth}
        source={source}
        tagsStyles={SPECS_TAG_STYLES}
        baseStyle={SPECS_TAG_STYLES.body}
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
