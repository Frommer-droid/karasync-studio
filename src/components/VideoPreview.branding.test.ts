import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DEFAULT_BRANDING } from '../../shared/types';
import type { VideoPreviewConfig } from '../../shared/types';
import { VideoPreview } from './VideoPreview';

describe('Branding author photo visibility in preview', () => {
  it('keeps editable title and lines when the author photo checkbox is off', () => {
    const config = {
      backgroundColor: '#231825',
      branding: {
        ...DEFAULT_BRANDING,
        showTitle: false,
        authorImageId: 'author-photo',
        title: 'Название песни',
        line1: 'Первая строка',
      },
    } as VideoPreviewConfig;

    const html = renderToStaticMarkup(React.createElement(VideoPreview, {
      activeLine: null,
      activeWord: null,
      nextLine: null,
      currentTime: 0,
      config,
      previewWidth: 100,
      activeSettingsPanel: null,
      onChangeConfig: () => {},
    }));

    assert.match(html, /value="Название песни"/);
    assert.match(html, /value="Первая строка"/);
    assert.doesNotMatch(html, />Фото<\/button>/);
  });
});
