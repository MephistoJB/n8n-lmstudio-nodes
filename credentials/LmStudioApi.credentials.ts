import type { ICredentialTestRequest, ICredentialType, INodeProperties, Icon } from 'n8n-workflow';

export class LmStudioApi implements ICredentialType {
    name = 'lmStudioApi';

    displayName = 'LM Studio API';

    icon: Icon = {
        light: 'file:../nodes/LmStudio/lmstudio.svg',
        dark: 'file:../nodes/LmStudio/lmstudio.dark.svg',
    };

    documentationUrl = 'https://lmstudio.ai/docs';

    properties: INodeProperties[] = [
        {
            displayName: 'Host URL',
            name: 'hostUrl',
            type: 'string',
            default: 'http://localhost:1234',
            placeholder: 'http://localhost:1234',
            description: 'LM Studio server URL including protocol and port',
        },
        {
            displayName: 'API Key',
            name: 'apiKey',
            type: 'string',
            typeOptions: { password: true },
            default: '',
            description:
                'Optional API key for LM Studio. Leave empty if your server does not require authentication.',
        },
    ];

    test: ICredentialTestRequest = {
        request: {
            baseURL: '={{$credentials?.hostUrl}}',
            url: '/api/v1/models',
            method: 'GET',
            headers: {
                Authorization: '={{$credentials?.apiKey ? "Bearer " + $credentials.apiKey : ""}}',
            },
        },
    };
}
