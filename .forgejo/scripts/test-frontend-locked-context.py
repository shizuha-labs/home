#!/usr/bin/env python3
"""Run the native archive caller against real Git inputs, without cluster/network."""
from pathlib import Path
import re
import subprocess
import tempfile
import textwrap
import unittest

ROOT=Path(__file__).resolve().parents[2]
WORKFLOW=ROOT/'.forgejo/workflows/deploy-frontend.yml'


class FrontendLockedContextTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.base=Path(self.tmp.name)
        self.mono=self.base/'monorepo'
        self.home=self.base/'home'
        self.destination=self.base/'test-context'
        self.packages_sha=self.repo(self.mono,{
            'package.json':'{"private":true}', 'package-lock.json':'{"name":"excluded-root"}',
            'private-infra.txt':'excluded', 'packages/unrelated/private.txt':'excluded',
            'packages/shizuha-ui/package.json':'{"name":"fixture-ui"}',
            'packages/shizuha-ui/package-lock.json':'{"name":"locked-ui"}',
            'packages/shizuha-chat/package.json':'{"name":"fixture-chat"}',
            'packages/shizuha-chat/package-lock.json':'{"name":"locked-chat"}',
        })
        self.home_sha=self.repo(self.home,{
            'frontend/package.json':'{"name":"fixture-frontend"}',
            'frontend/package-lock.json':'{"name":"locked-frontend"}',
            'frontend/src/unchanged.test.js':'tracked-test',
            'backend/never-copy.py':'excluded',
        })

    def git(self,repo,*args):
        return subprocess.check_output(['git','-C',str(repo),*args],text=True).strip()

    def repo(self,path,files):
        path.mkdir()
        self.git(path,'init','-q')
        self.git(path,'config','user.name','CI Fixture')
        self.git(path,'config','user.email','ci@example.test')
        for name,body in files.items():
            target=path/name
            target.parent.mkdir(parents=True,exist_ok=True)
            target.write_text(body)
        self.git(path,'add','--',*files)
        self.git(path,'commit','-qm','fixture input')
        return self.git(path,'rev-parse','HEAD')

    def native_context(self,packages_sha=None,home_sha=None):
        source=WORKFLOW.read_text()
        code=textwrap.dedent(source.split('# BEGIN exact frontend test context\n',1)[1]
                             .split('# END exact frontend test context',1)[0])
        code=code.replace('${{ env.HOME_FRONTEND_PACKAGES_COMMIT }}',packages_sha or self.packages_sha)
        code=code.replace('${{ github.sha }}',home_sha or self.home_sha)
        code=code.replace('/workspace/src/shizuha-home',str(self.home))
        code=code.replace('/workspace/src',str(self.mono))
        code=code.replace('/workspace/frontend-test-context',str(self.destination))
        code=code.replace('\\$','$')
        return subprocess.run(['bash','-euo','pipefail','-c',code],text=True,capture_output=True)

    def test_native_context_preserves_exact_tracked_locks_and_tests_only(self):
        (self.mono/'packages/shizuha-ui/untracked-private.txt').write_text('excluded')
        (self.home/'frontend/src/unchanged.test.js').write_text('unreviewed working copy')
        result=self.native_context()
        self.assertEqual(result.returncode,0,result.stderr)
        expected={'packages/shizuha-ui/package.json','packages/shizuha-ui/package-lock.json',
                  'packages/shizuha-chat/package.json','packages/shizuha-chat/package-lock.json',
                  'home/frontend/package.json','home/frontend/package-lock.json',
                  'home/frontend/src/unchanged.test.js','source-commits.txt'}
        self.assertEqual({str(p.relative_to(self.destination)) for p in self.destination.rglob('*') if p.is_file()},expected)
        self.assertEqual((self.destination/'home/frontend/src/unchanged.test.js').read_text(),'tracked-test')
        self.assertEqual((self.destination/'home/frontend/package-lock.json').read_text(),'{"name":"locked-frontend"}')
        self.assertEqual((self.destination/'source-commits.txt').read_text(),
                         f'packages={self.packages_sha}\nhome={self.home_sha}\n')

    def test_wrong_current_source_identity_refuses_before_creating_context(self):
        for field in ('packages','home'):
            with self.subTest(field=field):
                result=self.native_context(packages_sha='a'*40 if field=='packages' else None,
                                           home_sha='b'*40 if field=='home' else None)
                self.assertNotEqual(result.returncode,0)
                self.assertFalse(self.destination.exists())

    def test_existing_context_is_never_removed_or_overwritten(self):
        self.destination.mkdir()
        marker=self.destination/'preserved'
        marker.write_text('existing-owner')
        result=self.native_context()
        self.assertNotEqual(result.returncode,0)
        self.assertEqual(list(self.destination.iterdir()),[marker])
        self.assertEqual(marker.read_text(),'existing-owner')

    def test_all_install_callers_preserve_reviewed_locks_and_source_pin(self):
        source=WORKFLOW.read_text()
        self.assertRegex(source,r'HOME_FRONTEND_PACKAGES_COMMIT: [0-9a-f]{40}\b')
        self.assertEqual(source.count('echo "shared-package-source=${{ env.HOME_FRONTEND_PACKAGES_COMMIT }}"'),2)
        self.assertIn('workingDir: /workspace/home/frontend',source)
        self.assertIn('subPath: frontend-test-context',source)
        self.assertIn('SHIZUHA_PACKAGES_DIR=/workspace/packages npm test',source)
        self.assertIn('test-frontend-locked-context.py"',source)
        for filename in ('.forgejo/workflows/deploy-frontend.yml','Dockerfile.prod'):
            text=(ROOT/filename).read_text()
            commands=[line for line in text.splitlines() if not line.lstrip().startswith('#')]
            self.assertFalse(any(re.search(r'\bnpm\s+(?:install|update)\b',line) for line in commands),filename)
            self.assertFalse(any('rm' in line and 'package-lock.json' in line for line in commands),filename)
            self.assertNotIn('--legacy-peer-deps',text)
        docker=(ROOT/'Dockerfile.prod').read_text()
        self.assertIn('COPY ${FRONTEND_PATH}/frontend/package.json ${FRONTEND_PATH}/frontend/package-lock.json ./',docker)
        self.assertIn('ARG NPM_CONFIG_REGISTRY=',docker)
        self.assertEqual(docker.count('npm ci'),3)
        self.assertIn('WORKDIR /workspace/home/frontend',docker)
        self.assertIn('COPY --from=builder /workspace/home/frontend/dist',docker)


if __name__=='__main__':
    unittest.main()
