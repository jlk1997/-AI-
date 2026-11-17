/**
 * @license
 * Copyright 2025 OpenGame Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import {
  Modal,
  Tabs,
  Button,
  Space,
  Typography,
  Tag,
  Tooltip,
  message,
} from 'antd';
import {
  CodeOutlined,
  CopyOutlined,
  DownloadOutlined,
  FileOutlined,
  FolderOutlined,
} from '@ant-design/icons';

const { Text, Paragraph } = Typography;

interface FileNode {
  name: string;
  type: 'file' | 'folder';
  content?: string;
  children?: FileNode[];
}

interface CodeViewerProps {
  open: boolean;
  onClose: () => void;
  files: FileNode[];
  projectName?: string;
}

// 模拟文件内容（实际应该从后端获取）
const mockFiles: FileNode[] = [
  {
    name: 'src',
    type: 'folder',
    children: [
      {
        name: 'index.html',
        type: 'file',
        content: `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>贪吃蛇游戏</title>
  <style>
    body { margin: 0; padding: 20px; background: #1a1a2e; }
    canvas { display: block; margin: 0 auto; background: #000; }
  </style>
</head>
<body>
  <canvas id="game"></canvas>
  <script src="game.js"></script>
</body>
</html>`,
      },
      {
        name: 'game.js',
        type: 'file',
        content: `// 贪吃蛇游戏
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

// 游戏配置
const GRID_SIZE = 20;
const SPEED = 100;

canvas.width = 400;
canvas.height = 400;

// 蛇
let snake = [{ x: 10, y: 10 }];
let direction = 'right';
let food = { x: 15, y: 15 };
let score = 0;

// 绘制
function draw() {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // 蛇
  ctx.fillStyle = '#22c55e';
  snake.forEach(segment => {
    ctx.fillRect(
      segment.x * GRID_SIZE,
      segment.y * GRID_SIZE,
      GRID_SIZE - 2,
      GRID_SIZE - 2
    );
  });

  // 食物
  ctx.fillStyle = '#ef4444';
  ctx.fillRect(
    food.x * GRID_SIZE,
    food.y * GRID_SIZE,
    GRID_SIZE - 2,
    GRID_SIZE - 2
  );

  // 分数
  ctx.fillStyle = '#fff';
  ctx.font = '20px Arial';
  ctx.fillText('分数: ' + score, 10, 30);
}

// 游戏循环
function gameLoop() {
  update();
  draw();
  setTimeout(gameLoop, SPEED);
}

function update() {
  // 移动逻辑...
}

gameLoop();`,
      },
      {
        name: 'style.css',
        type: 'file',
        content: `* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  font-family: 'Segoe UI', sans-serif;
  background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
  min-height: 100vh;
  display: flex;
  justify-content: center;
  align-items: center;
}

#game {
  border-radius: 8px;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
}

.score {
  color: #22c55e;
  font-size: 24px;
  text-align: center;
  margin-bottom: 20px;
}`,
      },
    ],
  },
  {
    name: 'package.json',
    type: 'file',
    content: `{
  "name": "snake-game",
  "version": "1.0.0",
  "scripts": {
    "dev": "vite",
    "build": "vite build"
  }
}`,
  },
  {
    name: 'README.md',
    type: 'file',
    content: `# 贪吃蛇游戏

用 AI 生成的贪吃蛇游戏。

## 运行

\`\`\`bash
npm install
npm run dev
\`\`\``,
  },
];

export const CodeViewer: React.FC<CodeViewerProps> = ({
  open,
  onClose,
  files = mockFiles,
  projectName = '游戏项目',
}) => {
  const [activeTab, setActiveTab] = useState('index.html');
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  // 扁平化文件列表
  const flattenFiles = (
    nodes: FileNode[],
    path: string = ''
  ): { path: string; node: FileNode }[] => {
    const result: { path: string; node: FileNode }[] = [];
    nodes.forEach((node) => {
      const fullPath = path ? `${path}/${node.name}` : node.name;
      if (node.type === 'file') {
        result.push({ path: fullPath, node });
      }
      if (node.children) {
        result.push(...flattenFiles(node.children, fullPath));
      }
    });
    return result;
  };

  const flatFiles = flattenFiles(files);

  const handleCopy = (content: string) => {
    navigator.clipboard.writeText(content);
    message.success('已复制到剪贴板');
  };

  const handleDownload = (_filename: string, _content: string) => {
    message.info('源码只托管在工作室里，不会打包下载。改一句请走平台内改编。');
  };

  const getFileIcon = (filename: string) => {
    const ext = filename.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'html':
        return <span style={{ color: '#e34c26' }}>HTML</span>;
      case 'css':
        return <span style={{ color: '#264de4' }}>CSS</span>;
      case 'js':
        return <span style={{ color: '#f7df1e' }}>JS</span>;
      case 'json':
        return <span style={{ color: '#cbcb41' }}>JSON</span>;
      case 'md':
        return <span style={{ color: '#083fa1' }}>DOC</span>;
      default:
        return <FileOutlined />;
    }
  };

  const tabItems = flatFiles.map(({ path, node }) => ({
    key: path,
    label: (
      <Space>
        {getFileIcon(path)}
        <span>{path}</span>
      </Space>
    ),
    children: (
      <div style={{ position: 'relative' }}>
        <div
          style={{
            position: 'absolute',
            top: 8,
            right: 8,
            display: 'flex',
            gap: 8,
            zIndex: 1,
          }}
        >
          <Tooltip title="复制代码">
            <Button
              size="small"
              icon={<CopyOutlined />}
              onClick={() => handleCopy(node.content || '')}
            >
              复制
            </Button>
          </Tooltip>
          <Tooltip title="源码不下发">
            <Button
              size="small"
              icon={<DownloadOutlined />}
              disabled
              onClick={() => handleDownload(path, node.content || '')}
            >
              下载
            </Button>
          </Tooltip>
        </div>
        <pre
          style={{
            background: '#1f1f1f',
            color: '#e4e4e7',
            padding: 16,
            borderRadius: 8,
            fontSize: 13,
            overflow: 'auto',
            maxHeight: 500,
            fontFamily:
              "'Fira Code', 'Monaco', 'Consolas', 'Courier New', monospace",
          }}
        >
          {node.content || '(空文件)'}
        </pre>
      </div>
    ),
  }));

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={
        <Space>
          <CodeOutlined />
          <span>{projectName} - 代码文件</span>
          <Tag>{flatFiles.length} 个文件</Tag>
        </Space>
      }
      footer={[
        <Button key="close" onClick={onClose}>
          关闭
        </Button>,
        <Button key="hosted" disabled icon={<DownloadOutlined />}>
          源码不下发
        </Button>,
      ]}
      width={900}
      styles={{ body: { padding: 0 } }}
    >
      <div style={{ display: 'flex', height: 500 }}>
        {/* 文件列表 */}
        <div
          style={{
            width: 200,
            borderRight: '1px solid #303030',
            overflow: 'auto',
            padding: 8,
          }}
        >
          <Text
            type="secondary"
            style={{ fontSize: 11, padding: '4px 8px', display: 'block' }}
          >
            文件结构
          </Text>
          {files.map((node) =>
            node.type === 'folder' ? (
              <div key={node.name}>
                <div
                  style={{
                    padding: '4px 8px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    color: '#a1a1aa',
                    fontSize: 12,
                  }}
                >
                  <FolderOutlined />
                  <span>{node.name}</span>
                </div>
                {node.children?.map((child) => (
                  <div
                    key={child.name}
                    onClick={() => setActiveTab(`${node.name}/${child.name}`)}
                    style={{
                      padding: '4px 8px 4px 24px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      cursor: 'pointer',
                      borderRadius: 4,
                      background:
                        activeTab === `${node.name}/${child.name}`
                          ? '#262626'
                          : 'transparent',
                      color:
                        activeTab === `${node.name}/${child.name}`
                          ? '#6366f1'
                          : '#e4e4e7',
                      fontSize: 12,
                    }}
                  >
                    {getFileIcon(child.name)}
                    <span>{child.name}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div
                key={node.name}
                onClick={() => setActiveTab(node.name)}
                style={{
                  padding: '4px 8px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  cursor: 'pointer',
                  borderRadius: 4,
                  background:
                    activeTab === node.name ? '#262626' : 'transparent',
                  color: activeTab === node.name ? '#6366f1' : '#e4e4e7',
                  fontSize: 12,
                }}
              >
                {getFileIcon(node.name)}
                <span>{node.name}</span>
              </div>
            )
          )}
        </div>

        {/* 代码显示区 */}
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <Tabs
            activeKey={activeTab}
            onChange={setActiveTab}
            items={tabItems}
            style={{ padding: '0 16px' }}
            tabBarStyle={{ marginBottom: 0 }}
          />
        </div>
      </div>
    </Modal>
  );
};
