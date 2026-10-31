import { useCallback, useEffect, useState } from 'react';
import type { SettingsPageRequest } from '../features/settings/types';
import type { SectionId } from '../shared/types/navigation';
import { useToast } from '../shared/ui';

export function useTextModelSetupRedirect(requestSectionChange: (section: SectionId) => Promise<boolean>) {
  const [settingsRequest, setSettingsRequest] = useState<SettingsPageRequest | null>(null);
  const { showToast } = useToast();
  useEffect(() => {
    let active = true;
    void window.yibiao.modelProviders.list().then((models) => {
      if (!active || models.defaultTextId) return;
      showToast('尚未配置 AI 模型。请添加自己的 API Key 或连接本地模型。', 'info');
      setSettingsRequest({ tab: 'ai-model' });
      void requestSectionChange('settings');
    }).catch((error) => console.warn('读取 AI 模型配置失败', error));
    return () => { active = false; };
  }, []);
  const clearSettingsRequest = useCallback(() => setSettingsRequest(null), []);
  return { settingsRequest, clearSettingsRequest };
}
