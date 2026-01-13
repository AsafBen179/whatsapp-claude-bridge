const axios = require('axios');
const logger = require('../utils/logger');

/**
 * OpenRouter API client for AI summarization
 */
class OpenRouterClient {
  constructor() {
    this.baseUrl = 'https://openrouter.ai/api/v1';
    this.apiKey = null;
    this.model = null;
    this.client = null;
  }

  /**
   * Initialize with configuration
   */
  initialize(config) {
    this.apiKey = config.openRouter?.apiKey;
    this.model = config.openRouter?.model || 'anthropic/claude-3-haiku';
    this.maxTokens = config.openRouter?.maxTokens || 500;

    if (!this.apiKey) {
      logger.warn('OpenRouter API key not configured');
      return this;
    }

    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
        'HTTP-Referer': 'https://github.com/whatsapp-claude-bridge',
        'X-Title': 'WhatsApp Claude Bridge'
      }
    });

    logger.info('OpenRouter client initialized', { model: this.model });
    return this;
  }

  /**
   * Send a chat completion request
   */
  async chatCompletion(messages, options = {}) {
    if (!this.client) {
      throw new Error('OpenRouter client not initialized');
    }

    try {
      const response = await this.client.post('/chat/completions', {
        model: options.model || this.model,
        messages,
        max_tokens: options.maxTokens || this.maxTokens,
        temperature: options.temperature || 0.3
      });

      return response.data.choices[0].message.content;
    } catch (error) {
      logger.error('OpenRouter API error', {
        error: error.message,
        status: error.response?.status
      });
      throw error;
    }
  }

  /**
   * Summarize Claude Code output for WhatsApp
   */
  async summarize(output, context = {}) {
    if (!this.client) {
      // Fallback: return truncated output
      return this.fallbackSummarize(output);
    }

    const { systemPrompt, userPrompt } = this.buildSummaryPrompt(output, context);

    try {
      const summary = await this.chatCompletion([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ]);

      // Clean up the response - remove any echoed prompts or extra formatting
      return this.cleanSummaryResponse(summary);
    } catch (error) {
      logger.error('Summarization failed, using fallback', { error: error.message });
      return this.fallbackSummarize(output);
    }
  }

  /**
   * Clean up AI response to remove echoed prompts or extra content
   */
  cleanSummaryResponse(response) {
    let clean = response || '';

    // Remove any "Summarize this" instructions that got echoed
    clean = clean.replace(/Summarize this.*?(?:Output to summarize:|$)/gis, '');

    // Remove repeated "Rules:" sections
    clean = clean.replace(/Rules:[\s\S]*?Be direct and informative\.?/gi, '');

    // Remove "Original command:" if echoed
    clean = clean.replace(/Original command:.*?\n/gi, '');

    // Remove "Project:" if echoed at the start
    clean = clean.replace(/^\s*Project:.*?\n/gi, '');

    // Remove markdown headers that shouldn't be there
    clean = clean.replace(/^\*\*?Project:?\*\*?.*?\n/gim, '');
    clean = clean.replace(/^\*\*?Command:?\*\*?.*?\n/gim, '');
    clean = clean.replace(/^\*\*?Result:?\*\*?/gim, '');
    clean = clean.replace(/^\*\*?Status:?\*\*?.*$/gim, '');

    // Remove excessive whitespace and newlines
    clean = clean.replace(/\n{3,}/g, '\n\n').trim();

    return clean || response;
  }

  /**
   * Build summary prompt
   */
  buildSummaryPrompt(output, context) {
    const { commandText, projectName, isError } = context;

    const systemPrompt = `You are a concise summarizer. Your ONLY job is to output a brief summary (under 300 characters).
Do NOT echo the prompt, do NOT add headers like "Project:" or "Command:", do NOT add "Result:" or "Status:".
Just output the summary text directly. Use Hebrew if the input is in Hebrew.`;

    let userPrompt = `Summarize this output in one short sentence:\n\n${output.substring(0, 2000)}`;

    if (commandText) {
      userPrompt = `Command was: "${commandText}"\n\n${userPrompt}`;
    }

    if (isError) {
      userPrompt += '\n\nNote: This contains an error - mention it.';
    }

    return { systemPrompt, userPrompt };
  }

  /**
   * Fallback summarization when API is not available
   */
  fallbackSummarize(output) {
    // Extract key information
    let summary = '';

    // Check for success indicators
    if (/completed|success|done|finished/i.test(output)) {
      summary += 'Completed successfully. ';
    }

    // Check for errors
    if (/error|failed|exception/i.test(output)) {
      const errorMatch = output.match(/error[:\s]+(.{0,100})/i);
      if (errorMatch) {
        summary += `Error: ${errorMatch[1].trim()}. `;
      } else {
        summary += 'Error occurred. ';
      }
    }

    // Check for file operations
    const fileMatches = output.match(/(?:created|modified|deleted|read)\s+['"]?([^'"]+)['"]?/gi);
    if (fileMatches && fileMatches.length > 0) {
      summary += `Files: ${fileMatches.slice(0, 3).join(', ')}`;
      if (fileMatches.length > 3) {
        summary += ` +${fileMatches.length - 3} more`;
      }
    }

    // If no key info found, truncate output
    if (!summary) {
      summary = output.substring(0, 400);
      if (output.length > 400) {
        summary += '...';
      }
    }

    return summary.trim();
  }

  /**
   * Check if client is configured
   */
  isConfigured() {
    return !!this.apiKey;
  }

  /**
   * Get available models
   */
  async getModels() {
    if (!this.client) {
      throw new Error('Client not initialized');
    }

    try {
      const response = await this.client.get('/models');
      return response.data.data;
    } catch (error) {
      logger.error('Failed to get models', { error: error.message });
      throw error;
    }
  }
}

module.exports = new OpenRouterClient();
