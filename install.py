import os
import pwd
import subprocess
import os.path

ownerAccount = 590186200215
notebookExtensionName = "@amzn/awsgluenotebooks-extensions"
overridesPathBase = "/settings/overrides.json"
jupiterFolder = "~/.jupyter"
jupiterConfig = "jupyter_notebook_config.py"


def getSytemPrefix():
    processOutput = subprocess.run(["jupyter", "lab", "path"], stdout=subprocess.PIPE)
    path = processOutput.stdout.split()[2]
    decodedPath = path.decode("utf-8")
    return decodedPath


def getOverridesPath():
    return f"{getSytemPrefix()}/settings/overrides.json"


def getUsername():
    return pwd.getpwuid(os.getuid())[0]


def getJupiterConfigPath():
    return os.path.expanduser(f"{jupiterFolder}/{jupiterConfig}")


def replaceLine(fileName, lineNum, text):
    lines = open(fileName, "r").readlines()
    lines[lineNum] = text
    out = open(fileName, "w")
    out.writelines(lines)
    out.close()


def codeArtifactSubProcess(toolName):
    return [
        "aws",
        "codeartifact",
        "login",
        "--tool",
        toolName,
        "--repository",
        "aws-glue",
        "--domain",
        "amazon",
        "--domain-owner",
        str(ownerAccount),
    ]


subprocess.run(codeArtifactSubProcess("npm"))
subprocess.run(codeArtifactSubProcess("pip"))
subprocess.run(codeArtifactSubProcess("twine"))
subprocess.run(
    [
        "jupyter",
        "labextension",
        "install",
        notebookExtensionName,
    ]
)

if os.path.exists(getJupiterConfigPath()):
    os.remove(getJupiterConfigPath())

subprocess.run(
    [
        "jupyter",
        "notebook",
        "--generate-config",
    ]
)

replaceLine(getJupiterConfigPath(), 83, "c.NotebookApp.allow_origin = '*'\n\n")
