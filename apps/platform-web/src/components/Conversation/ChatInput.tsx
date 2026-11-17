/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Input, Upload, message } from 'antd';
import { PictureOutlined, SendOutlined, LoadingOutlined } from '@ant-design/icons';
import type { UploadFile, RcFile } from 'antd/lib/upload/interface';
import { useT } from '../../services/i18n';

const { TextArea } = Input;

interface ChatInputProps {
  onSend: (content: string, images?: string[]) => void;
  loading?: boolean;
  placeholder?: string;
  /** Fill textarea from recovery / quick actions (nonce forces re-apply). */
  draftValue?: string;
  draftNonce?: number;
  /** World create: empty send means generate from the brief above. */
  allowEmptySend?: boolean;
  /** Ember for games, teal for towns. */
  generationMode?: 'game' | 'world';
}

export const ChatInput: React.FC<ChatInputProps> = ({
  onSend,
  loading,
  placeholder,
  draftValue,
  draftNonce = 0,
  allowEmptySend = false,
  generationMode = 'game',
}) => {
  const { t } = useT();
  const [value, setValue] = useState('');
  const [images, setImages] = useState<UploadFile[]>([]);
  const [focused, setFocused] = useState(false);
  const textAreaRef = useRef<any>(null);

  useEffect(() => {
    if (draftNonce > 0 && typeof draftValue === 'string' && draftValue.length > 0) {
      setValue(draftValue);
      requestAnimationFrame(() => {
        try {
          textAreaRef.current?.focus?.({ cursor: 'end' });
        } catch {
          textAreaRef.current?.focus?.();
        }
      });
    }
  }, [draftNonce, draftValue]);

  const thumbUrls = useMemo(() => {
    return images.map((file) => {
      if (file.thumbUrl) return file.thumbUrl;
      if (file.originFileObj) return URL.createObjectURL(file.originFileObj);
      return '';
    });
  }, [images]);

  useEffect(() => {
    return () => {
      thumbUrls.forEach((url) => {
        if (url.startsWith('blob:')) URL.revokeObjectURL(url);
      });
    };
  }, [thumbUrls]);

  const canSend = Boolean(value.trim() || images.length > 0 || allowEmptySend);

  const handleSend = () => {
    if (!value.trim() && images.length === 0) {
      if (allowEmptySend && !loading) onSend('');
      return;
    }

    const imagePromises = images.map((file) => {
      return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file.originFileObj as RcFile);
      });
    });

    Promise.all(imagePromises).then((imageUrls) => {
      onSend(value.trim(), imageUrls);
      setValue('');
      setImages([]);
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const beforeUpload = (file: RcFile) => {
    const isImage = file.type.startsWith('image/');
    if (!isImage) {
      message.error(t('chat.upload.onlyImage'));
      return false;
    }
    const isLt5M = file.size / 1024 / 1024 < 5;
    if (!isLt5M) {
      message.error(t('chat.upload.maxSize'));
      return false;
    }
    return true;
  };

  const handleImageChange = ({ fileList }: { fileList: UploadFile[] }) => {
    if (fileList.length > 4) {
      message.warning(t('chat.upload.maxCount'));
      return;
    }
    setImages(fileList);
  };

  return (
    <div
      className={`og-composer ${generationMode === 'world' ? 'is-world' : 'is-game'} ${
        focused ? 'is-focused' : ''
      }`}
    >
      {images.length > 0 ? (
        <div className="og-composer__thumbs">
          {images.map((file, i) => (
            <button
              key={file.uid}
              type="button"
              className="og-composer__thumb"
              aria-label={t('chat.upload.remove')}
              onClick={() => setImages((prev) => prev.filter((f) => f.uid !== file.uid))}
            >
              {thumbUrls[i] ? <img src={thumbUrls[i]} alt="" /> : null}
              <span className="og-composer__thumb-x">×</span>
            </button>
          ))}
        </div>
      ) : null}

      <div className="og-composer__row">
        <Upload
          accept="image/*"
          showUploadList={false}
          beforeUpload={beforeUpload}
          onChange={handleImageChange}
          fileList={images}
          multiple
        >
          <button
            type="button"
            className="og-composer__attach"
            style={
              images.length > 0 ? { color: 'var(--composer-accent)' } : undefined
            }
            aria-label={t('chat.upload.onlyImage')}
          >
            <PictureOutlined />
          </button>
        </Upload>

        <TextArea
          ref={textAreaRef}
          className="og-composer__field"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={placeholder ?? t('chat.placeholder')}
          autoSize={{ minRows: 1, maxRows: 4 }}
        />

        <button
          type="button"
          className="og-composer__send"
          onClick={handleSend}
          disabled={!canSend || Boolean(loading)}
          aria-label={t('chat.send')}
        >
          {loading ? <LoadingOutlined /> : <SendOutlined />}
        </button>
      </div>

      <div className="og-composer__hint">
        {t('chat.enterHint')}
        {images.length > 0 ? ` · ${t('chat.imagesSelected', { count: images.length })}` : ''}
      </div>
    </div>
  );
};
