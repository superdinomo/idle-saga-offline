# coding=UTF8
# 表格从0开始索引 
import codecs
import os.path
import sys
import json
from collections import OrderedDict
reload(sys)
sys.setdefaultencoding('utf8')

bigSkillJsonFile = "..\\skill.json"
# mergeSkillJsonFile = "mergeskill.json"
smallSkillJsonFile = "..\\1.json"
bigSkillJsonFileData = {}
smallSkillJsonFileData = {}

def loadBigSkillJsonFile():
	global bigSkillJsonFile
	global bigSkillJsonFileData
	if os.path.exists(bigSkillJsonFile):
		with codecs.open(bigSkillJsonFile, 'r', "utf-8") as f:
			bigSkillJsonFileData = json.load(f)
	else:
		bigSkillJsonFileData = {}

def loadSmallSkillJsonFile():
	global smallSkillJsonFile
	global smallSkillJsonFileData
	try:
		if os.path.exists(smallSkillJsonFile):
			with codecs.open(smallSkillJsonFile, 'r', "utf-8") as f:
				smallSkillJsonFileData = json.load(f)
		else:
			smallSkillJsonFileData = {}
	except:
		print u"请检查 1.json"
		print u"合成失败!"
		sys.exit(0)

def mergeSkillData():
	global bigSkillJsonFileData
	global smallSkillJsonFileData
	for skillId, skillData in smallSkillJsonFileData.items():
		if bigSkillJsonFileData.has_key(skillId):
			print u"修改技能：" + str(skillId)
		else:
			print u"新增技能:" + str(skillId)
		bigSkillJsonFileData[skillId] = skillData
	
	smallJsonFileHandle = open(smallSkillJsonFile, "r+")
	smallJsonFileHandle.truncate()

def saveMergeSkillData():
	global bigSkillJsonFile
	global bigSkillJsonFileData
	bigSkillJsonFileData = OrderedDict(sorted(bigSkillJsonFileData.items(),key=lambda t: t[0]))
	with codecs.open(bigSkillJsonFile, 'w', "utf-8") as f:
		json.dump(bigSkillJsonFileData, f)
		
loadBigSkillJsonFile()
loadSmallSkillJsonFile()
mergeSkillData()
saveMergeSkillData()

print u"合并成功!"
