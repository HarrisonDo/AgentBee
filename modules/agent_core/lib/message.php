<?php

/**
 * Agent Core module for AgentBee
 *
 * Copyright 2026 秋水之冰 <27206617@qq.com>
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

namespace modules\agent_core\lib;

use modules\agent_openai\go;
use Nervsys\Core\Factory;

class message extends Factory
{
    public utils $utils;

    /**
     * @throws \ReflectionException
     */
    public function __construct()
    {
        $this->utils = utils::new();
    }

    /**
     * @param string $socket_id
     * @param array  $data_content
     *
     * @return array|string[]
     * @throws \ReflectionException
     * @throws \Exception
     */
    public function process_setting(string $socket_id, array $data_content): array
    {
        $act = $data_content['act'] ?? 'unknown';

        switch ($act) {
            case 'getConfig':
                $current = config::new()->get(false);
                $content = [
                    'status'  => 'success',
                    'act'     => $act,
                    'content' => $current
                ];

                unset($current);
                break;

            case 'saveConfig':
                $config_hash = config::new()->save($data_content['data']);
                $content     = [
                    'status'  => 'success',
                    'act'     => $act,
                    'content' => $config_hash,
                ];

                unset($config_hash);
                break;

            case 'getDefaultConfig':
                $defaults = config::new()->getDefault();
                $content  = [
                    'status'  => 'success',
                    'act'     => $act,
                    'content' => $defaults
                ];

                unset($defaults);
                break;

            default:
                $content = [
                    'status' => 'error',
                    'error'  => 'Unsupported act: ' . $data_content['act']
                ];
                break;
        }

        $result = [
            'need_llm' => false,
            'content'  => $content,
            'type'     => 'setting'
        ];

        unset($socket_id, $data_content, $act, $content);
        return $result;
    }

    /**
     * @param string $socket_id
     * @param array  $data_content
     *
     * @return array
     * @throws \ReflectionException
     */
    public function process_system(string $socket_id, array $data_content): array
    {
        $act = $data_content['act'] ?? 'unknown';

        switch ($act) {
            case 'getVersion':
                $content = [
                    'AGENT'   => AGENT_NAME . ' v' . AGENT_VERSION,
                    'Nervsys' => NS_NAMESPACE . ' v' . NS_VER,
                ];
                break;

            case 'getModels':
                $content        = go::new()->getModels();
                $content['act'] = $act;
                break;

            case 'reasoningEfforts':
                $content        = [
                    'status' => 'success',
                    'data'   => ['none', 'minimal', 'low', 'medium', 'high', 'xhigh']
                ];
                $content['act'] = $act;
                break;

            default:
                $content = [
                    'status' => 'error',
                    'error'  => 'Unsupported act: ' . $data_content['act']
                ];
                break;
        }

        $result = [
            'need_llm' => false,
            'content'  => $content,
            'type'     => 'system'
        ];

        unset($socket_id, $data_content, $act, $content);
        return $result;
    }

    /**
     * @param string $socket_id
     * @param array  $data_content
     * @param string $session_id
     *
     * @return array
     * @throws \ReflectionException
     */
    public function process_memory(string $socket_id, array $data_content, string $session_id): array
    {
        $act = $data_content['act'] ?? 'unknown';

        switch ($act) {
            case 'read':
                $content = $data_content['memory']->read('misc', 0, 0, $data_content['length'], $session_id, $data_content['create_id'] ?? 0, true);

                $content['act'] = $act;
                break;

            case 'delete':
                $content = [] !== $data_content['create_ids']
                    ? $data_content['memory']->delete('misc', $data_content['create_ids'])
                    : ['status' => 'error', 'error' => '缺少目标记忆ID'];

                $content['act'] = $act;
                break;

            case 'readSession':
                $content = $data_content['memory']->readSession(1, true);

                $content['act'] = $act;
                break;

            case 'renameSession':
                if ('' !== $session_id && '' !== ($data_content['session_name'] ?? '')) {
                    $content = $data_content['memory']->updateSession($session_id, $data_content['session_name']);
                } else {
                    $content = ['status' => 'error', 'error' => '缺少会话ID'];
                }

                $content['act'] = $act;
                break;

            case 'deleteSession':
                if ('' !== $session_id) {
                    $context = context::new();
                    $context->removeHistory($session_id, WORKER_MAIN);
                    $context->removeMessageQueue($session_id, WORKER_MAIN);
                    $content = $data_content['memory']->updateSession($session_id, '', 2);
                } else {
                    $content = ['status' => 'error', 'error' => '缺少会话ID'];
                }

                $content['act'] = $act;
                break;

            default:
                $content = [
                    'status' => 'error',
                    'error'  => 'Unsupported act: ' . $data_content['act']
                ];
                break;
        }

        $result = [
            'need_llm' => false,
            'content'  => $content,
            'type'     => 'memory'
        ];

        unset($socket_id, $data_content, $session_id, $act, $content);
        return $result;
    }

    /**
     * Normal text chat
     *
     * @param string $socket_id
     * @param array  $data_content
     *
     * @return array
     */
    public function process_text(string $socket_id, array $data_content): array
    {
        $text = trim($data_content['text'] ?? '');

        if ('' !== $text) {
            if ('/reset' !== $text) {
                $result = [
                    'need_llm' => true,
                    'content'  => [['type' => 'text', 'content' => $text]],
                    'saves'    => [$text],
                    'type'     => 'chat'
                ];
            } else {
                $result = [
                    'need_llm' => false,
                    'content'  => ['status' => 'success', 'act' => 'reset', 'content' => '好了，上下文已重置，我们继续吧。'],
                    'type'     => 'message'
                ];
            }
        } else {
            $result = [
                'need_llm' => false,
                'content'  => ['status' => 'success', 'act' => 'idle', 'content' => '我在呢。有需要就告诉我，没事也可以聊两句。'],
                'type'     => 'message'
            ];
        }

        unset($socket_id, $data_content, $text);
        return $result;
    }

    /**
     * Multimodal content chat
     *
     * Expected input $data structure:
     * - 'text' (string): plain text message
     * - 'file' (array): list of text files, each as:
     *      ['filename' => ..., 'mimeType' => ..., 'content' => ...] (base64 content)
     *
     * @param string $socket_id
     * @param array  $data_content
     *
     * @return array Associative array with 'need_llm' (bool), 'content' (multimodal content array) and others.
     */
    public function process_chat(string $socket_id, array $data_content): array
    {
        $content = [];
        $errors  = [];
        $saves   = [];
        $reset   = false;

        foreach ($data_content as $data) {
            if (!isset($data['type'])) {
                continue;
            }

            // 1. Handle plain text
            if ('text' === $data['type']) {
                $text = trim($data['text'] ?? '');

                if ('' === $text) {
                    continue;
                }

                if ('/reset' !== $text) {
                    $saves[]   = $text;
                    $content[] = ['type' => 'text', 'content' => $text];
                } else {
                    $reset = true;
                }

                continue;
            }

            // 2. Handle files/images
            if ('file' === $data['type']) {
                if (!isset($data['file']['filename']) || !isset($data['file']['content']) || '' === $data['file']['content']) {
                    continue;
                }

                $binary = base64_decode($data['file']['content']);

                // 2.1 Process images
                if ('' !== $this->utils->getImageType($binary)) {
                    if (!$this->imageIsAllowed($data['file']['filename'])) {
                        $errors[] = $data['file']['filename'] . '：图片格式不支持';
                        continue;
                    }

                    try {
                        $data_url  = $this->utils->resizeImage($binary);
                        $content[] = ['type' => 'text', 'content' => '"' . $data['file']['filename'] . '"：图片已加载到上下文，无需读取文件，直接识别。'];
                        $content[] = ['type' => 'image', 'content' => $data_url];
                    } catch (\Throwable $throwable) {
                        $errors[] = $data['file']['filename'] . '：' . $throwable->getMessage();
                        unset($throwable);
                        continue;
                    }

                    continue;
                }

                // 2.2 Process plain text files
                if (!$this->fileIsText($data['file']['filename']) || str_contains($binary, "\0")) {
                    $errors[] = $data['file']['filename'] . '：文件格式不支持';
                    continue;
                }

                try {
                    $detected  = mb_detect_encoding($binary, ['GB18030', 'UTF-8', 'BIG-5', 'ASCII'], true);
                    $file_text = iconv($detected ?: 'UTF-8', 'UTF-8//IGNORE', $binary) ?: '';

                    if ('' === $file_text) {
                        throw new \RuntimeException('文本提取失败');
                    }

                    $content[] = [
                        'type'    => 'text',
                        'content' => '--- 文件信息 ---' . "\n"
                            . '文件名: ' . $data['file']['filename'] . "\n"
                            . 'MIME类型: ' . $data['file']['mimeType'] . "\n"
                            . '--- 文件内容（开始） ---' . "\n"
                            . $file_text . "\n"
                            . '--- 文件内容（结束） ---'
                    ];
                } catch (\Throwable $throwable) {
                    $errors[] = $data['file']['filename'] . '：' . $throwable->getMessage();
                    unset($throwable);
                    continue;
                }
            }
        }

        if ([] !== $content) {
            $result = [
                'need_llm' => true,
                'content'  => $content,
                'errors'   => $errors,
                'saves'    => $saves,
                'type'     => 'chat'
            ];
        } else {
            $result = [
                'need_llm' => false,
                'content'  => $reset
                    ? ['status' => 'success', 'act' => 'reset', 'content' => '好了，上下文已重置，我们继续吧。']
                    : ['status' => 'success', 'act' => 'idle', 'content' => '我在呢。有需要就告诉我，没事也可以聊两句。'],
                'type'     => 'message'
            ];
        }

        unset($socket_id, $data_content, $content, $errors, $saves, $reset, $data, $text, $binary, $data_url, $detected, $file_text);
        return $result;
    }

    /**
     * @param string $filename
     *
     * @return bool
     */
    private function imageIsAllowed(string $filename): bool
    {
        $whitelist = ['jpg', 'jpeg', 'tif', 'tiff', 'webp', 'png', 'bmp', 'gif'];
        $extension = strtolower(pathinfo($filename, PATHINFO_EXTENSION));
        $allowed   = in_array($extension, $whitelist, true);

        unset($filename, $whitelist, $extension);
        return $allowed;
    }

    /**
     * Check plain text file extension
     *
     * @param string $filename
     *
     * @return bool
     */
    private function fileIsText(string $filename): bool
    {
        $whitelist = [
            // 文本
            'txt', 'log', 'md', 'rst', 'csv', 'tsv', 'diff', 'patch', 'markdown',

            // 网页
            'html', 'htm', 'xhtml', 'xml', 'svg',
            'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx',
            'css', 'scss', 'sass', 'less', 'vue', 'svelte',

            // 配置
            'ini', 'env', 'cfg', 'cnf', 'conf', 'json', 'jsonl', 'yml', 'yaml', 'toml', 'properties',

            // 系统脚本
            'sh', 'bash', 'zsh', 'bat', 'cmd', 'ps1',

            // 编程源码
            'php', 'py', 'r', 'rb', 'go', 'rs', 'swift', 'cs', 'dart',
            'java', 'kt', 'kts', 'scala', 'groovy', 'lua',
            'c', 'cpp', 'cc', 'cxx', 'h', 'hpp',

            // 数据库
            'sql', 'graphql',

            // 字幕
            'srt', 'vtt', 'ass', 'ssa', 'lrc', 'sub', 'idx',
        ];

        $extension = strtolower(pathinfo($filename, PATHINFO_EXTENSION));
        $allowed   = in_array($extension, $whitelist, true);

        unset($filename, $whitelist, $extension);
        return $allowed;
    }
}