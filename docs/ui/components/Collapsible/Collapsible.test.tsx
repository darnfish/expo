import { fireEvent, render, screen } from '@testing-library/react';
import GithubSlugger from 'github-slugger';
import { PropsWithChildren } from 'react';

import { Collapsible } from '.';

import { HeadingManager, HeadingType } from '~/common/headingManager';
import { HeadingsContext } from '~/components/page-higher-order/withHeadingManager';

const prepareHeadingManager = () => {
  const headingManager = new HeadingManager(new GithubSlugger(), { headings: [] });
  headingManager.addHeading('Base level heading', undefined, {});
  headingManager.addHeading('Level 3 subheading', 3, {});
  headingManager.addHeading('Code heading depth 1', 0, {
    sidebarDepth: 1,
    sidebarType: HeadingType.InlineCode,
  });

  return headingManager;
};

const WrapWithContext = ({ children }: PropsWithChildren) => {
  const headingManager = prepareHeadingManager();
  return <HeadingsContext.Provider value={headingManager}>{children}</HeadingsContext.Provider>;
};

describe('Collapsible', () => {
  it('hides content by default', () => {
    render(
      <WrapWithContext>
        <Collapsible summary="Summary">Content</Collapsible>
      </WrapWithContext>
    );
    expect(screen.getByText('Summary')).toBeVisible();
    expect(screen.getByText('Content')).not.toBeVisible();
  });

  it('shows content when opened', () => {
    render(
      <WrapWithContext>
        <Collapsible summary="Summary">Content</Collapsible>
      </WrapWithContext>
    );
    fireEvent.click(screen.getByText('Summary'));
    expect(screen.getByText('Summary')).toBeVisible();
    expect(screen.getByText('Content')).toBeVisible();
  });

  it('shows content when rendered with open', () => {
    render(
      <WrapWithContext>
        <Collapsible summary="Summary" open>
          Content
        </Collapsible>
      </WrapWithContext>
    );
    expect(screen.getByText('Summary')).toBeVisible();
    expect(screen.getByText('Content')).toBeVisible();
  });
});
