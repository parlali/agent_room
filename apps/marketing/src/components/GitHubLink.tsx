import { ExternalArrowIcon, GithubIcon } from './Icons'

const repoUrl = 'https://github.com/parlali/agent_room'

type Props = {
    className?: string
}

export function GitHubLink({ className }: Props) {
    return (
        <a
            href={repoUrl}
            target="_blank"
            rel="noreferrer"
            aria-label="Agent Room on GitHub"
            className={
                className ??
                'inline-flex items-center gap-2 rounded-sm px-2 py-1.5 text-[var(--color-ink-dim)] transition-colors duration-300 ease-out hover:text-[var(--color-ink)]'
            }
        >
            <GithubIcon size={18} />
            <ExternalArrowIcon size={13} className="opacity-70" />
        </a>
    )
}
