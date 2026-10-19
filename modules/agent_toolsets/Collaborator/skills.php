<?php

/**
 * Agent Worker module for AgentBee
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

namespace modules\agent_toolsets\Collaborator;

class skills
{
    public const META = [
        [
            'type'     => 'function',
            'function' => [
                'name'        => 'invite',
                'description' => '邀请协作者共同处理任务（专家顾问、相关人士、普通人员等）。须提供完整任务背景，对方回复“已就绪”后交流，用于辩论/协作。异步进行，按需沟通至完成。返回{message}。',
                'parameters'  => [
                    'type'       => 'object',
                    'properties' => [
                        'worker_name' => ['type' => 'string', 'description' => '协作者唯一名称'],
                        'worker_role' => ['type' => 'string', 'description' => '身份与领域，如“代码审查”“社区沟通”“居民代表”'],
                        'init_prompt' => ['type' => 'string', 'description' => '首条指令，设定方向与准则（勿填具体任务）']
                    ],
                    'required'   => ['worker_name', 'worker_role', 'init_prompt']
                ],
            ],
        ],
        [
            'type'     => 'function',
            'function' => [
                'name'        => 'talk',
                'description' => '向协作者发送消息进行交流，回复异步送达。收到回复后判断任务是否完成，未完成则继续；期间可处理其他任务，不必等待。长消息拆分，禁止重发。返回{message}。',
                'parameters'  => [
                    'type'       => 'object',
                    'properties' => [
                        'worker_name' => ['type' => 'string', 'description' => '协作者名称'],
                        'content'     => ['type' => 'string', 'description' => '消息内容']
                    ],
                    'required'   => ['worker_name', 'content']
                ],
            ],
        ],
        [
            'type'     => 'function',
            'function' => [
                'name'        => 'close',
                'description' => '结束与协作者的交流并释放资源。任务完成/对方无响应/上下文过长时调用；如需继续，重新邀请并传摘要。返回{message}。',
                'parameters'  => [
                    'type'       => 'object',
                    'properties' => [
                        'worker_name' => ['type' => 'string', 'description' => '协作者名称']
                    ],
                    'required'   => ['worker_name']
                ],
            ],
        ],
        [
            'type'     => 'function',
            'function' => [
                'name'        => 'list',
                'description' => '查看活跃协作者状态（ready/busy/streaming/calling_tools）。仅偶尔查看，禁止连续调用（会阻塞交流）。返回状态列表。'
            ],
        ]
    ];
}